from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.types import TimestampMixin


class FlashDeal(TimestampMixin, Base):
    """A timed sale event. The window (``starts_at``/``ends_at``) plus
    ``is_active`` decide whether its items price at the deal price; "end
    early" just pulls ``ends_at`` back to now, so history stays honest.
    """

    __tablename__ = "flash_deals"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    items: Mapped[list["FlashDealItem"]] = relationship(
        back_populates="deal", cascade="all, delete-orphan", lazy="selectin"
    )


class FlashDealItem(Base):
    """One variant on sale inside a deal.

    The price is either an absolute ``deal_price`` or a ``deal_percent`` off
    the variant's list price — exactly one must be set (CHECK below). Deal
    stock is sold through ``deal_stock_sold``: checkout takes a unit with a
    conditional UPDATE (``sold + qty <= limit``) inside the order
    transaction, so two customers racing for the last unit serialise and
    exactly one wins. Cancelling/expiring the order gives the unit back
    (floored at zero, so a double release can never inflate stock).
    """

    __tablename__ = "flash_deal_items"
    __table_args__ = (
        UniqueConstraint("deal_id", "variant_id", name="uq_flash_deal_item"),
        # XOR: an item prices at an absolute deal price OR a percent off.
        CheckConstraint(
            "(deal_price IS NULL) <> (deal_percent IS NULL)",
            name="ck_flash_deal_item_price_xor",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    deal_id: Mapped[int] = mapped_column(
        ForeignKey("flash_deals.id", ondelete="CASCADE"), index=True, nullable=False
    )
    variant_id: Mapped[int] = mapped_column(
        ForeignKey("product_variants.id", ondelete="CASCADE"), index=True, nullable=False
    )
    deal_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    # percent: 1-99 (20 means 20% off the variant's list price)
    deal_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    deal_stock_limit: Mapped[int] = mapped_column(Integer, nullable=False)
    deal_stock_sold: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    per_user_limit: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    deal: Mapped[FlashDeal] = relationship(back_populates="items")
