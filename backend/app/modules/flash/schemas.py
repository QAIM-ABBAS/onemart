"""Schemas for the flash-deal endpoints (public strip + admin management)."""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DealItemOut(BaseModel):
    """One buyable line of a live deal (storefront strip / PDP badge)."""

    id: int
    variant_id: int
    product_id: int
    product_name: str
    product_slug: str
    image_url: str | None = None
    variant_name: str
    list_price: str
    deal_price: str
    percent_off: str
    stock_limit: int
    stock_sold: int
    remaining: int
    claimed_percent: str
    per_user_limit: int | None = None
    # Present only for signed-in users (how many more they may buy).
    per_user_remaining: int | None = None


class DealOut(BaseModel):
    id: int
    name: str
    starts_at: str | None = None
    ends_at: str | None = None
    items: list[DealItemOut]


class DealWrite(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def _ends_after_starts(self) -> "DealWrite":
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("End time must be after the start time")
        return self


class DealItemWrite(BaseModel):
    variant_id: int = Field(ge=1)
    deal_price: Decimal | None = Field(default=None, ge=0.01)
    deal_percent: Decimal | None = Field(default=None, ge=1, le=99)
    deal_stock_limit: int = Field(ge=1, le=100_000)
    per_user_limit: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _price_xor_percent(self) -> "DealItemWrite":
        if (self.deal_price is None) == (self.deal_percent is None):
            raise ValueError("Set either a deal price or a percent off — not both")
        return self


class DealAdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_active: bool
    status: str  # live | scheduled | ended | inactive
    item_count: int = 0
    stock_sold: int = 0
    stock_limit: int = 0
    created_at: datetime | None = None


class DealItemAdminOut(BaseModel):
    id: int
    deal_id: int
    variant_id: int
    product_name: str
    product_slug: str
    variant_name: str
    sku: str
    # Response money is float, like every other response schema here (Decimal
    # is for request validation only).
    list_price: float
    deal_price: float | None = None
    deal_percent: float | None = None
    effective_price: float
    stock_limit: int
    stock_sold: int
    remaining: int
    claimed_percent: float
    per_user_limit: int | None = None


class VariantSearchRow(BaseModel):
    """A pickable variant for the admin's add-item dialog."""

    variant_id: int
    product_id: int
    product_name: str
    product_slug: str
    variant_name: str
    sku: str
    price: float
    image_url: str | None = None
    # Non-null when this variant is already claimed by a live deal.
    in_live_deal: str | None = None
