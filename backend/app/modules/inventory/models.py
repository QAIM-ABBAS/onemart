import enum
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.types import TimestampMixin, string_enum


class ReservationStatus(enum.StrEnum):
    """Lifecycle of a hold on a variant's stock.

    ``active``   — held for an order that has not been paid yet (online payment)
    ``consumed`` — the units left the shelf (COD at checkout, or payment landed)
    ``released`` — the hold was dropped (payment timeout, cancellation)
    """

    ACTIVE = "active"
    CONSUMED = "consumed"
    RELEASED = "released"


class Inventory(Base):
    """Stock level for a single variant. Row is locked with FOR UPDATE at checkout."""

    __tablename__ = "inventory"

    variant_id: Mapped[int] = mapped_column(
        ForeignKey("product_variants.id", ondelete="CASCADE"), primary_key=True
    )
    quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reserved: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    low_stock_threshold: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    variant = relationship("ProductVariant", back_populates="inventory")

    @property
    def available(self) -> int:
        return max(self.quantity - self.reserved, 0)


class StockMovement(Base):
    """Append-only audit trail of stock changes."""

    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    variant_id: Mapped[int] = mapped_column(
        ForeignKey("product_variants.id", ondelete="CASCADE"), index=True, nullable=False
    )
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity_after: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class StockReservation(TimestampMixin, Base):
    """A hold on ``qty`` units of a variant for one order.

    Written in the same transaction that locks the inventory row, so the hold
    and the availability check can never disagree. ``Inventory.reserved`` is the
    running total of this order's *active* rows for that variant — every screen
    that says "available" is reading ``quantity - reserved``.

    Lock order everywhere in the app: Order → Inventory → StockReservation.
    """

    __tablename__ = "stock_reservations"
    __table_args__ = (
        Index("ix_stock_reservations_order_status", "order_id", "status"),
        Index("ix_stock_reservations_status_expires", "status", "expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    variant_id: Mapped[int] = mapped_column(
        ForeignKey("product_variants.id", ondelete="CASCADE"), index=True, nullable=False
    )
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[ReservationStatus] = mapped_column(
        string_enum(ReservationStatus, "reservation_status"),
        default=ReservationStatus.ACTIVE,
        nullable=False,
    )
    # Null for consumed-at-checkout (COD) rows: there is nothing to sweep.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

