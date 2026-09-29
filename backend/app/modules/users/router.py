from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.exceptions import ConflictError, UnauthorizedError
from app.core.security import (
    TokenError,
    consume_refresh_token,
    create_access_token,
    hash_password,
    issue_refresh_token,
    verify_password,
)
from app.modules.cart import service as cart_service
from app.modules.users.models import Address, User
from app.modules.users.schemas import (
    AddressIn,
    AddressOut,
    AuthResponse,
    LoginIn,
    RegisterIn,
    UserOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])
address_router = APIRouter(prefix="/addresses", tags=["addresses"])


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.cookie_name,
        token,
        max_age=settings.refresh_token_ttl_days * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(settings.cookie_name, path="/")


def _issue(response: Response, user: User) -> AuthResponse:
    access = create_access_token(user.id, user.role.value)
    refresh = issue_refresh_token(user.id)
    _set_refresh_cookie(response, refresh)
    return AuthResponse(access_token=access, user=UserOut.from_user(user))


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(
    payload: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)
):
    email = payload.email.lower().strip()
    if db.scalar(select(User.id).where(User.email == email)):
        raise ConflictError("An account with this email already exists")
    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip(),
    )
    db.add(user)
    db.flush()
    user.last_login_at = datetime.now(UTC)
    cart_service.resolve_cart(db, request, response, user)
    db.commit()
    return _issue(response, user)


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower().strip()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise UnauthorizedError("Incorrect email or password")
    if not user.is_active:
        raise UnauthorizedError("This account has been disabled")
    user.last_login_at = datetime.now(UTC)
    cart_service.resolve_cart(db, request, response, user)
    db.commit()
    return _issue(response, user)


@router.post("/refresh", response_model=AuthResponse)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise UnauthorizedError("No refresh token provided")
    try:
        user_id = consume_refresh_token(token)
    except TokenError as exc:
        _clear_refresh_cookie(response)
        raise UnauthorizedError(str(exc)) from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        _clear_refresh_cookie(response)
        raise UnauthorizedError("Account not found")
    cart_service.resolve_cart(db, request, response, user)
    db.commit()
    return _issue(response, user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(settings.cookie_name)
    if token:
        try:
            consume_refresh_token(token)
        except TokenError:
            pass
    _clear_refresh_cookie(response)
    cart_service.clear_cart_cookie(response)
    return Response(status_code=204)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut.from_user(user)


@address_router.get("", response_model=list[AddressOut])
def list_addresses(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(
        select(Address)
        .where(Address.user_id == user.id)
        .order_by(Address.is_default.desc(), Address.created_at.desc())
    ).all()
    return rows


@address_router.post("", response_model=AddressOut, status_code=201)
def create_address(
    payload: AddressIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    if payload.is_default:
        db.execute(
            Address.__table__.update()
            .where(Address.user_id == user.id)
            .values(is_default=False)
        )
    address = Address(user_id=user.id, **payload.model_dump())
    db.add(address)
    db.commit()
    db.refresh(address)
    return address


@address_router.delete("/{address_id}", status_code=204)
def delete_address(
    address_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    address = db.scalar(
        select(Address).where(Address.id == address_id, Address.user_id == user.id)
    )
    if address is None:
        from app.core.exceptions import NotFoundError

        raise NotFoundError("Address not found")
    db.delete(address)
    db.commit()
    return Response(status_code=204)
