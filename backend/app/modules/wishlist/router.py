from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.pagination import PaginationParams
from app.modules.users.models import User
from app.modules.wishlist import service
from app.modules.wishlist.schemas import WishlistIdsOut, WishlistPage, WishlistToggleOut

router = APIRouter(tags=["wishlist"])


@router.get("/wishlist", response_model=WishlistPage)
def list_wishlist(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=48),
    sort: str = "recent",
    q: str | None = Query(None, max_length=120),
    in_stock: bool = False,
):
    params = PaginationParams(page=page, page_size=page_size, sort=sort)
    return service.list_items(db, user, params, q=q, in_stock=in_stock)


@router.get("/wishlist/ids", response_model=WishlistIdsOut)
def wishlist_ids(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return service.list_ids(db, user)


@router.post("/wishlist/{product_id}", response_model=WishlistToggleOut)
def add_to_wishlist(
    product_id: int,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    product = service.get_product(db, product_id)
    _, created = service.add(db, user, product)
    # First save is a create; a repeat tap is not.
    response.status_code = 201 if created else 200
    return service.toggle_out(db, user, product_id, saved=True)


@router.delete("/wishlist/{product_id}", response_model=WishlistToggleOut)
def remove_from_wishlist(
    product_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    service.remove(db, user, product_id)
    return service.toggle_out(db, user, product_id, saved=False)