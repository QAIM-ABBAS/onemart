from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.orders.models import OrderStatus, PaymentStatus
from app.modules.users.schemas import AddressIn


class CheckoutIn(BaseModel):
    payment_method: str = "cod"
    address_id: int | None = None
    address: AddressIn | None = None
    save_address: bool = False
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _require_address(self):
        if self.address_id is None and self.address is None:
            raise ValueError("Provide address_id or a new address")
        return self


class OrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    variant_id: int | None
    product_name: str
    variant_name: str
    sku: str
    product_slug: str
    image_url: str | None
    unit_price: float
    quantity: int
    line_total: float

    @model_validator(mode="before")
    @classmethod
    def _cast(cls, data):
        if isinstance(data, dict):
            data = dict(data)
            for key in ("unit_price", "line_total"):
                if isinstance(data.get(key), Decimal):
                    data[key] = float(data[key])
        return data


class StatusEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: OrderStatus
    note: str | None
    created_at: datetime


class OrderListItem(BaseModel):
    id: int
    order_number: str
    status: OrderStatus
    payment_method: str
    payment_status: PaymentStatus
    total: float
    item_count: int
    created_at: datetime

    @model_validator(mode="before")
    @classmethod
    def _cast(cls, data):
        if isinstance(data, dict) and isinstance(data.get("total"), Decimal):
            data = dict(data)
            data["total"] = float(data["total"])
        return data


class OrderDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_number: str
    status: OrderStatus
    payment_method: str
    payment_status: PaymentStatus
    recipient_name: str
    phone: str
    line1: str
    line2: str | None
    city: str
    state: str
    postal_code: str
    country: str
    subtotal: float
    discount_total: float = 0.0
    coupon_code: str | None = None
    delivery_fee: float
    total: float
    customer_note: str | None
    created_at: datetime
    placed_at: datetime
    items: list[OrderItemOut]
    history: list[StatusEventOut]

    @model_validator(mode="before")
    @classmethod
    def _cast(cls, data):
        if isinstance(data, dict):
            data = dict(data)
            for key in ("subtotal", "discount_total", "delivery_fee", "total"):
                if isinstance(data.get(key), Decimal):
                    data[key] = float(data[key])
        return data


class StatusUpdateIn(BaseModel):
    status: OrderStatus
    note: str | None = Field(default=None, max_length=255)


class PaymentMethodInfo(BaseModel):
    code: str
    name: str
