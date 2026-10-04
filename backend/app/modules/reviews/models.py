from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.types import TimestampMixin


class Review(TimestampMixin, Base):
    """One review per customer per product.

    ``verified_purchase`` is derived server-side from delivered orders at write
    time — never taken from the client — and ``rating_avg``/``rating_count`` on
    the product are recomputed in the same transaction as any change here.
    """

    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("product_id", "user_id", name="uq_reviews_product_user"),
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_reviews_rating_range"),
        # The public list is "this product, visible, newest first".
        Index("ix_reviews_product_visible_created", "product_id", "is_visible", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    verified_purchase: Mapped[bool] = mapped_column(default=False, nullable=False)
    # Moderation: hidden reviews stay in the table (and out of the average).
    is_visible: Mapped[bool] = mapped_column(default=True, nullable=False)
    helpful_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    product = relationship("Product", lazy="selectin")
    user = relationship("User", lazy="selectin")


class ReviewVote(Base):
    """A "helpful" mark, one per customer per review — the sort key behind
    the 'most helpful' ordering."""

    __tablename__ = "review_votes"
    # Composite PK *is* the one-vote-per-customer guarantee.

    review_id: Mapped[int] = mapped_column(
        ForeignKey("reviews.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
