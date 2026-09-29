from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.core.security import TokenError, decode_access_token
from app.modules.users.models import User, UserRole


def _bearer_token(request: Request) -> str | None:
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def get_current_user_optional(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = _bearer_token(request)
    if not token:
        return None
    try:
        payload = decode_access_token(token)
    except TokenError:
        return None
    return db.get(User, int(payload["sub"]))


def get_current_user(user: User | None = Depends(get_current_user_optional)) -> User:
    if user is None or not user.is_active:
        raise UnauthorizedError("Sign in to continue")
    return user


def get_current_customer(user: User = Depends(get_current_user)) -> User:
    return user


def get_current_staff(user: User = Depends(get_current_user)) -> User:
    if user.role not in (UserRole.STAFF, UserRole.ADMIN):
        raise ForbiddenError("Staff access required")
    return user
