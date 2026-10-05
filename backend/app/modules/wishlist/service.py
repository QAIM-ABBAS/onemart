from sqlalchemy import asc, delete, desc, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.core.pagination import Page, PaginationParams
from app.modules.catalog.models import Product
from app.modules.catalog.service import available_sq, min_price_sq
from app.modules.wishlist.models import WishlistItem
from app.modules.wishlist.schemas import (
    WishlistIdsOut,
    WishlistItemOut,
    WishlistToggleOut,
    WishlistVariant,
)

# The account page offers these orderings; anything else falls back to recent.
VALID_SORTS = {"recent", "oldest", "price_asc", "price_desc", "name"}


def get_product(db: Session, product_id: int) -> Product:
    """The product behind a heart tap — inactive/deleted items cannot be saved."""
    product = db.get(Product, product_id)
    if product is None or not product.is_active:
        raise NotFoundError("Product not found")
    return product


def _filters(user_id: int, q: str | None, in_stock: bool) -> list:
    filters = [WishlistItem.user_id == user_id, Product.is_active.is_(True)]
    if q and q.strip():
        needle = f"%{q.strip()}%"
        filters.append(or_(Product.name.ilike(needle), Product.description.ilike(needle)))
    if in_stock:
        # Reuses the catalogue's stock subquery so both screens agree on
        # what "in stock" means.
        filters.append(available_sq() > 0)
    return filters


def _sorted(stmt, sort: str):
    if sort == "oldest":
        return stmt.order_by(asc(WishlistItem.created_at), asc(WishlistItem.id))
    if sort == "price_asc":
        return stmt.order_by(asc(min_price_sq()), asc(Product.name))
    if sort == "price_desc":
        return stmt.order_by(desc(min_price_sq()), asc(Product.name))
    if sort == "name":
        return stmt.order_by(asc(Product.name))
    return stmt.order_by(desc(WishlistItem.created_at), desc(WishlistItem.id))


def to_out(item: WishlistItem) -> WishlistItemOut:
    """Price and stock are read live: a saved item never shows a stale number."""
    product = item.product
    active = [v for v in product.variants if v.is_active]
    price = min((v.price for v in active), default=0)
    compare = min(
        (v.compare_at_price for v in active if v.compare_at_price is not None),
        default=None,
    )
    available = sum(v.inventory.available for v in active if v.inventory)
    discount = None
    if compare is not None and price and compare > price:
        discount = round(float((compare - price) / compare) * 100)
    return WishlistItemOut(
        id=item.id,
        added_at=item.created_at,
        product_id=product.id,
        name=product.name,
        slug=product.slug,
        thumbnail=product.images[0].url if product.images else None,
        price=float(price),
        compare_at_price=float(compare) if compare is not None else None,
        discount_percent=discount,
        available=available,
        in_stock=available > 0,
        rating_avg=float(product.rating_avg),
        rating_count=product.rating_count,
        variants=[
            WishlistVariant(
                id=v.id,
                name=v.name,
                price=float(v.price),
                compare_at_price=float(v.compare_at_price) if v.compare_at_price else None,
                available=v.inventory.available if v.inventory else 0,
                is_default=v.is_default,
            )
            for v in active
        ],
    )


def list_items(
    db: Session,
    user,
    params: PaginationParams,
    q: str | None = None,
    in_stock: bool = False,
) -> Page[WishlistItemOut]:
    filters = _filters(user.id, q, in_stock)
    total = db.execute(
        select(func.count())
        .select_from(WishlistItem)
        .join(Product, Product.id == WishlistItem.product_id)
        .where(*filters)
    ).scalar_one()

    sort = params.sort if params.sort in VALID_SORTS else "recent"
    stmt = _sorted(
        select(WishlistItem).join(Product, Product.id == WishlistItem.product_id).where(*filters),
        sort,
    )
    rows = db.scalars(stmt.offset(params.offset).limit(params.page_size)).all()

    pages = max((total + params.page_size - 1) // params.page_size, 1) if total else 1
    return Page[WishlistItemOut](
        items=[to_out(row) for row in rows],
        total=total,
        page=params.page,
        page_size=params.page_size,
        pages=pages,
    )


def list_ids(db: Session, user) -> WishlistIdsOut:
    """Every saved product id, newest first — one cheap query for the hearts."""
    rows = db.execute(
        select(WishlistItem.product_id)
        .join(Product, Product.id == WishlistItem.product_id)
        .where(WishlistItem.user_id == user.id, Product.is_active.is_(True))
        .order_by(desc(WishlistItem.created_at), desc(WishlistItem.id))
    ).all()
    ids = [row[0] for row in rows]
    return WishlistIdsOut(ids=ids, count=len(ids))


def add(db: Session, user, product: Product) -> tuple[WishlistItem, bool]:
    """Idempotent save: the second tap returns the existing row, not an error."""
    existing = db.scalar(
        select(WishlistItem).where(
            WishlistItem.user_id == user.id,
            WishlistItem.product_id == product.id,
        )
    )
    if existing is not None:
        return existing, False

    item = WishlistItem(user_id=user.id, product_id=product.id)
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        # Two taps in the same instant: the unique constraint already won.
        db.rollback()
        existing = db.scalar(
            select(WishlistItem).where(
                WishlistItem.user_id == user.id,
                WishlistItem.product_id == product.id,
            )
        )
        if existing is None:
            raise
        return existing, False
    return item, True


def remove(db: Session, user, product_id: int) -> None:
    """Idempotent unsave — removing something already gone is still a success."""
    db.execute(
        delete(WishlistItem).where(
            WishlistItem.user_id == user.id,
            WishlistItem.product_id == product_id,
        )
    )
    db.commit()


def _count(db: Session, user_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(WishlistItem)
            .where(WishlistItem.user_id == user_id)
        )
        or 0
    )


def toggle_out(db: Session, user, product_id: int, saved: bool) -> WishlistToggleOut:
    """Includes the running total so the header badge updates without a refetch."""
    return WishlistToggleOut(product_id=product_id, saved=saved, count=_count(db, user.id))
