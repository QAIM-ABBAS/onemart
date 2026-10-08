"""Payment attempts.

One row per attempt against a gateway: an order can be initiated, fail, be
retried and finally paid, and every attempt keeps its own provider reference and
raw response. The order's own ``payment_status`` is the summary of the latest
attempt; this table is the audit trail.

Deliberately free of imports from other app modules (the FK is a plain table
name) so ``orders.models`` can register this mapper for its ``payments``
relationship without an import cycle.
"""

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.db import Base
from app.core.types import TimestampMixin, string_enum

RawResponse = JSON().with_variant(JSONB(), "postgresql")


class PaymentAttemptStatus(enum.StrEnum):
    INITIATED = "initiated"
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"
    REFUNDED = "refunded"
    PARTIALLY_REFUNDED = "partially_refunded"


# Statuses from which an attempt may still move (used for idempotent callbacks:
# anything terminal is never rewritten by a second copy of the same callback).
TERMINAL_PAYMENT_STATUSES = {
    PaymentAttemptStatus.PAID,
    PaymentAttemptStatus.REFUNDED,
    PaymentAttemptStatus.PARTIALLY_REFUNDED,
}


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        Index("ix_payments_order_created", "order_id", "created_at"),
        Index("ix_payments_status_created", "status", "created_at"),
        Index("ix_payments_provider_ref", "provider_ref"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    # What *we* charged — the number every verification and refund is made
    # against. Never taken from a redirect parameter.
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="INR", nullable=False)
    status: Mapped[PaymentAttemptStatus] = mapped_column(
        string_enum(PaymentAttemptStatus, "payment_attempt_status"),
        default=PaymentAttemptStatus.INITIATED,
        nullable=False,
    )
    # Gateway handle (Zarinpal authority, Stripe intent id, …).
    provider_ref: Mapped[str | None] = mapped_column(String(128))
    refunded_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    # Last gateway answer, verbatim — shown in Admin > Payments > detail.
    raw_response: Mapped[dict] = mapped_column(RawResponse, default=dict, nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Resolved by name at mapper-configuration time: importing Order here would
    # be a cycle (orders.models registers this mapper for Order.payments).
    order = relationship("Order", back_populates="payments")
