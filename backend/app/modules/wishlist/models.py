from sqlalchemy import ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.types import TimestampMixin


class WishlistItem(TimestampMixin, Base):
    """A saved product — one row per customer per product.

    Product-level, not variant-level: the account page picks a variant at
    add-to-cart time exactly like the product page does, so a saved item stays
    valid when prices or stock move.
    """

    __tablename__ = "wishlist_items"
    __table_args__ = (
        UniqueConstraint("user_id", "product_id", name="uq_wishlist_user_product"),
        # The account list query: this customer, newest saved first.
        Index("ix_wishlist_items_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False
    )

    product = relationship("Product", lazy="selectin")
