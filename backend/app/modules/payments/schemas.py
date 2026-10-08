from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.payments.models import PaymentAttemptStatus


class PaymentAttemptOut(BaseModel):
    """One attempt, as the customer (or a list row) sees it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    order_id: int
    provider: str
    amount: float
    currency: str
    status: PaymentAttemptStatus
    provider_ref: str | None = None
    refunded_amount: float = 0.0
    created_at: datetime
    paid_at: datetime | None = None

    @model_validator(mode="before")
    @classmethod
    def _cast(cls, data):
        if isinstance(data, dict):
            data = dict(data)
            for key in ("amount", "refunded_amount"):
                if isinstance(data.get(key), Decimal):
                    data[key] = float(data[key])
        return data


class PaymentAdminOut(PaymentAttemptOut):
    order_number: str = ""


class PaymentDetailOut(PaymentAdminOut):
    order_status: str
    raw_response: dict = Field(default_factory=dict)
    attempts: list[PaymentAttemptOut] = Field(default_factory=list)


class PaymentInitiateOut(BaseModel):
    payment_id: int
    order_id: int
    redirect_url: str
    status: str
    amount: float
    currency: str
    expires_at: datetime | None = None


class PaymentStatusOut(BaseModel):
    payment_id: int
    order_id: int
    order_number: str
    status: str
    amount: float
    currency: str
    order_status: str
    payment_deadline: datetime | None = None
    already_processed: bool = False


class RefundIn(BaseModel):
    amount: float | None = Field(default=None, gt=0)
    reason: str | None = Field(default=None, max_length=255)
    # Tick for "the money moved outside the gateway" (bank transfer, COD handback)
    manual: bool = False
