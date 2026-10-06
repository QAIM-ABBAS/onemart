from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CouponApplyIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)


class CouponOut(BaseModel):
    """The applied coupon as the cart sees it."""

    code: str
    kind: str
    value: float
    description: str | None = None
    # What it actually removes from *this* cart (0.0 if it no longer applies;
    # the waived delivery for a free_delivery coupon)
    discount: float = 0.0


class CouponAdminOut(BaseModel):
    """A coupon as the admin list shows it, with its computed status chip."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    description: str | None = None
    kind: str
    value: float
    min_subtotal: float
    max_discount: float | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    usage_limit: int | None = None
    per_user_limit: int | None = None
    used_count: int
    is_active: bool
    status: str = "active"
    created_at: datetime


class CouponWrite(BaseModel):
    """Create or (with ``model_dump(exclude_unset=True)``) partially update.

    Everything except the identity fields is optional so PATCH can send only
    what changed; the service validates the *merged* result either way.
    """

    code: str | None = Field(None, min_length=1, max_length=40)
    description: str | None = Field(None, max_length=255)
    kind: Literal["percent", "fixed", "free_delivery"] | None = None
    value: float | None = Field(None, ge=0)
    min_subtotal: float | None = Field(None, ge=0)
    max_discount: float | None = Field(None, gt=0)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    usage_limit: int | None = Field(None, ge=1)
    per_user_limit: int | None = Field(None, ge=1)
    is_active: bool | None = None


class DiscountAdminOut(BaseModel):
    """A discount rule with its target's display name and status chip."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    scope: str
    kind: str
    value: float
    product_id: int | None = None
    category_id: int | None = None
    product_name: str | None = None
    category_name: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_active: bool
    status: str = "active"
    created_at: datetime


class DiscountWrite(BaseModel):
    scope: Literal["product", "category"] | None = None
    kind: Literal["percent", "fixed"] | None = None
    value: float | None = Field(None, ge=0)
    product_id: int | None = None
    category_id: int | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_active: bool | None = None
