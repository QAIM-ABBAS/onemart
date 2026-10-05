from datetime import datetime

from pydantic import BaseModel, Field

from app.core.pagination import Page


class WishlistVariant(BaseModel):
    """Just enough to add to cart from the wishlist without another fetch."""

    id: int
    name: str
    price: float
    compare_at_price: float | None = None
    available: int
    is_default: bool = False


class WishlistItemOut(BaseModel):
    id: int
    added_at: datetime
    product_id: int
    name: str
    slug: str
    thumbnail: str | None = None
    # Live pricing/stock, always read at request time — a saved item never
    # caches a stale price.
    price: float
    compare_at_price: float | None = None
    discount_percent: int | None = None
    available: int
    in_stock: bool
    rating_avg: float = 0.0
    rating_count: int = 0
    variants: list[WishlistVariant] = Field(default_factory=list)


class WishlistPage(Page[WishlistItemOut]):
    """Paginated wishlist."""


class WishlistIdsOut(BaseModel):
    """Lightweight "which of these cards are saved?" payload for the hearts."""

    ids: list[int]
    count: int


class WishlistToggleOut(BaseModel):
    product_id: int
    saved: bool
    count: int
