import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.types import TimestampMixin, string_enum


class CouponKind(enum.StrEnum):
    PERCENT = "percent"
    FIXED = "fixed"


class Coupon(TimestampMixin, Base):
    """A discount code. The row is the guard for its own usage limit: checkout
    increments ``used_count`` with a conditional UPDATE in the order transaction,
    so two customers racing for the last redemption cannot both win."""

    __tablename__ = "coupons"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))
    kind: Mapped[CouponKind] = mapped_column(string_enum(CouponKind, "coupon_kind"), nullable=False)
    # percent: 1-100 (10 means 10% off) · fixed: rupees off
    value: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    min_subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    max_discount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    usage_limit: Mapped[int | None] = mapped_column(Integer)
    per_user_limit: Mapped[int | None] = mapped_column(Integer)
    used_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    redemptions: Mapped[list["CouponRedemption"]] = relationship(
        back_populates="coupon", cascade="all, delete-orphan", lazy="selectin"
    )


class CouponRedemption(Base):
    """One row per order that used a coupon — the audit trail behind
    ``Coupon.used_count`` and the source of ``per_user_limit``."""

    __tablename__ = "coupon_redemptions"
    __table_args__ = (UniqueConstraint("coupon_id", "order_id", name="uq_coupon_redemption_order"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    coupon_id: Mapped[int] = mapped_column(
        ForeignKey("coupons.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    coupon: Mapped[Coupon] = relationship(back_populates="redemptions")
