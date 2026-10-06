from decimal import Decimal

from pydantic import BaseModel, Field

from app.modules.discounts.schemas import CouponOut


class CartItemOut(BaseModel):
    id: int
    variant_id: int
    product_id: int
    product_name: str
    product_slug: str
    variant_name: str
    sku: str
    image_url: str | None = None
    unit_price: float
    quantity: int
    line_total: float
    available: int
    in_stock: bool


class CartOut(BaseModel):
    id: int
    items: list[CartItemOut]
    subtotal: float
    auto_discount: float = 0.0
    discount: float = 0.0
    coupon: CouponOut | None = None
    delivery_fee: float
    total: float
    # How much more the customer must spend for free delivery, judged on the
    # goods after all discounts — computed by the pricing engine (Decimal), so
    # the UI never has to re-derive the threshold in float arithmetic.
    free_delivery_gap: float = 0.0
    item_count: int


class AddItemIn(BaseModel):
    variant_id: int
    quantity: int = Field(default=1, ge=1, le=99)


class UpdateItemIn(BaseModel):
    quantity: int = Field(ge=1, le=99)


def price(value: Decimal | float) -> float:
    return float(value)
