from pydantic import BaseModel, Field


class CouponApplyIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)


class CouponOut(BaseModel):
    """The applied coupon as the cart sees it."""

    code: str
    kind: str
    value: float
    description: str | None = None
    # What it actually removes from *this* cart (0.0 if it no longer applies)
    discount: float = 0.0
