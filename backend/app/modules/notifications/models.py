import enum
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.types import TimestampMixin


class NotificationType(enum.StrEnum):
    ORDER_PLACED = "order_placed"
    ORDER_STATUS = "order_status"
    ORDER_CANCELLED = "order_cancelled"
    REVIEW_HIDDEN = "review_hidden"
    # Admin-triggered broadcast — lands with the admin discounts screens step.
    ANNOUNCEMENT = "announcement"


class Notification(TimestampMixin, Base):
    """One inbox row per event.

    Rows are only ever written through `notify()`, which joins the caller's
    transaction — a rolled-back action never leaves a phantom notification
    (same contract as `audit.record`).
    """

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        # The inbox query: this user, newest first.
        Index("ix_notifications_user_created", "user_id", "created_at"),
        # The unread badge/count.
        Index("ix_notifications_user_read", "user_id", "read_at"),
    )
