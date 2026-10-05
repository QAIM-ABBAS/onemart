import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.exceptions import AppError
from app.core.types import TimestampMixin, string_enum

# Registers the Coupon/CouponRedemption mappers (referenced by Order and Cart)
from app.modules.discounts import models as discounts_models  # noqa: F401


class OrderStatus(enum.StrEnum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    PACKED = "packed"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


class PaymentStatus(enum.StrEnum):
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"
    REFUNDED = "refunded"


ALLOWED_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.PENDING: {OrderStatus.CONFIRMED, OrderStatus.CANCELLED},
    OrderStatus.CONFIRMED: {OrderStatus.PACKED, OrderStatus.CANCELLED},
    OrderStatus.PACKED: {OrderStatus.SHIPPED, OrderStatus.CANCELLED},
    OrderStatus.SHIPPED: {OrderStatus.DELIVERED},
    OrderStatus.DELIVERED: set(),
    OrderStatus.CANCELLED: set(),
}

TERMINAL_STATUSES = {OrderStatus.DELIVERED, OrderStatus.CANCELLED}
# Admin may cancel anything that has not shipped (see ALLOWED_TRANSITIONS);
# a customer only while the order is still at the front of the line.
CANCELLABLE_STATUSES = {OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PACKED}
CUSTOMER_CANCELLABLE_STATUSES = {OrderStatus.PENDING, OrderStatus.CONFIRMED}


class Order(TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (Index("ix_orders_user_created", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    order_number: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    status: Mapped[OrderStatus] = mapped_column(
        string_enum(OrderStatus, "order_status"), default=OrderStatus.PENDING, nullable=False
    )
    payment_method: Mapped[str] = mapped_column(String(40), nullable=False)
    payment_status: Mapped[PaymentStatus] = mapped_column(
        string_enum(PaymentStatus, "payment_status"), default=PaymentStatus.PENDING, nullable=False
    )

    # Delivery address snapshot (orders keep their own copy)
    recipient_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    line1: Mapped[str] = mapped_column(String(255), nullable=False)
    line2: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[str] = mapped_column(String(120), nullable=False)
    postal_code: Mapped[str] = mapped_column(String(20), nullable=False)
    country: Mapped[str] = mapped_column(String(2), default="IN", nullable=False)

    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    delivery_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Coupon snapshot: the code is copied onto the order so history survives the
    # coupon row being edited or deleted later; SET NULL keeps the order intact.
    coupon_id: Mapped[int | None] = mapped_column(
        ForeignKey("coupons.id", ondelete="SET NULL"), index=True
    )
    coupon_code: Mapped[str | None] = mapped_column(String(40))
    customer_note: Mapped[str | None] = mapped_column(Text)

    placed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user = relationship("User", lazy="selectin")
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", lazy="selectin"
    )
    history: Mapped[list["OrderStatusHistory"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="(OrderStatusHistory.created_at, OrderStatusHistory.id)",
        lazy="selectin",
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    variant_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_variants.id", ondelete="SET NULL")
    )
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))

    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    variant_name: Mapped[str] = mapped_column(String(120), nullable=False)
    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    product_slug: Mapped[str] = mapped_column(String(280), nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(500))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")


class OrderStatusHistory(Base):
    """Append-only timeline. Updates/deletes are blocked at ORM and DB level."""

    __tablename__ = "order_status_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    status: Mapped[OrderStatus] = mapped_column(
        string_enum(OrderStatus, "order_status"), nullable=False
    )
    note: Mapped[str | None] = mapped_column(String(255))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    order: Mapped[Order] = relationship(back_populates="history")


def _deny_history_mutation(mapper, connection, target):  # noqa: ANN001
    raise AppError("Order status history is append-only", details={"resource": "history"})


@event.listens_for(OrderStatusHistory, "before_update")
def _history_update(*args):
    _deny_history_mutation(*args)


@event.listens_for(OrderStatusHistory, "before_delete")
def _history_delete(*args):
    _deny_history_mutation(*args)
