"""The promotional banner engine's storage model.

A banner is one creative bound to exactly one *placement* — the slot on a
page it renders in. The storefront never lists "all banners": each component
asks for its own placement and gets back only what is on, in-window and
highest priority, so scheduling and ordering live entirely server-side.
"""

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.types import TimestampMixin, string_enum
from app.modules.catalog.models import Category


class BannerPlacement(enum.StrEnum):
    """Where a banner renders. This list is the contract between Admin ▸
    Banners and the frontend components, which request by placement."""

    HOME_HERO = "home_hero"          # homepage carousel (max 5 active)
    HOME_MID_STRIP = "home_mid_strip"  # the single promo card beside/below the hero
    CATEGORY_HEADER = "category_header"  # header banner, one per category page
    CART_PROMO = "cart_promo"        # the promo strip on the cart


class BannerLinkType(enum.StrEnum):
    """Where the CTA sends the shopper. ``product``/``category``/``coupon``
    targets are resolved to a storefront route when the payload is built,
    so a renamed slug or code never leaves a dead banner."""

    PRODUCT = "product"
    CATEGORY = "category"
    COUPON = "coupon"
    URL = "url"


class Banner(TimestampMixin, Base):
    """A scheduled creative in one placement.

    ``is_active`` is the on/off switch and ``starts_at``/``ends_at`` the
    schedule (both nullable: blank = immediate / runs forever). Analytics
    counters are flushed here from a Redis buffer by a Celery task every
    minute — a page view never writes to Postgres directly.
    """

    __tablename__ = "banners"
    __table_args__ = (
        # A category header must point at a category, and only it may.
        CheckConstraint(
            "(placement = 'category_header') = (category_id IS NOT NULL)",
            name="ck_banners_category_placement",
        ),
        CheckConstraint("tone IN ('light', 'brand')", name="ck_banners_tone"),
        # The public query is always placement + active, ordered by priority.
        Index("ix_banners_placement_active", "placement", "is_active"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    eyebrow: Mapped[str | None] = mapped_column(String(60))
    subtitle: Mapped[str | None] = mapped_column(String(255))
    cta_label: Mapped[str | None] = mapped_column(String(60))
    # Hero slides sit on a light or brand-dark card; other placements ignore it.
    tone: Mapped[str] = mapped_column(String(16), default="light", nullable=False)
    image_desktop: Mapped[str] = mapped_column(String(500), nullable=False)
    image_mobile: Mapped[str | None] = mapped_column(String(500))
    alt: Mapped[str | None] = mapped_column(String(160))
    placement: Mapped[BannerPlacement] = mapped_column(
        string_enum(BannerPlacement, "banner_placement"), nullable=False
    )
    # Set exactly when placement == category_header (CHECK above).
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), index=True
    )
    link_type: Mapped[BannerLinkType] = mapped_column(
        string_enum(BannerLinkType, "banner_link_type"), nullable=False
    )
    link_target: Mapped[str] = mapped_column(String(255), nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Flushed from the Redis buffer by banners.flush_stats (never touched
    # directly by request handlers).
    impressions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    clicks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    category: Mapped[Category | None] = relationship(lazy="selectin")
