"""Schemas for the banner endpoints (public payloads, admin CRUD, tracking)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.modules.banners.models import BannerLinkType, BannerPlacement

PromoStatus = Literal["active", "scheduled", "expired", "inactive"]
Tone = Literal["light", "brand"]


class BannerOut(BaseModel):
    """One creative for a storefront component — fields the components
    render plus ``href``, resolved server-side from link_type/link_target
    so renamed slugs/codes can never leave a dead banner."""

    id: int
    title: str
    eyebrow: str | None = None
    subtitle: str | None = None
    cta_label: str | None = None
    tone: Tone = "light"
    image_desktop: str
    image_mobile: str | None = None
    alt: str | None = None
    placement: BannerPlacement
    link_type: BannerLinkType
    link_target: str
    href: str


class BannerWrite(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    eyebrow: str | None = Field(default=None, max_length=60)
    subtitle: str | None = Field(default=None, max_length=255)
    cta_label: str | None = Field(default=None, max_length=60)
    tone: Tone = "light"
    image_desktop: str = Field(min_length=1, max_length=500)
    image_mobile: str | None = Field(default=None, max_length=500)
    alt: str | None = Field(default=None, max_length=160)
    placement: BannerPlacement
    category_id: int | None = None
    link_type: BannerLinkType
    link_target: str = Field(min_length=1, max_length=255)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    priority: int = Field(default=0, ge=0, le=100_000)
    is_active: bool = True


class BannerAdminOut(BannerWrite):
    id: int
    # Computed server-side (defaults exist only so model_validate can read
    # straight off the ORM row — both are overwritten below).
    status: PromoStatus = "active"
    category_name: str | None = None
    # Live counters: the flushed DB values plus whatever still sits in the
    # Redis buffer, so staff see events within seconds of them happening.
    impressions: int
    clicks: int
    ctr: float = 0.0  # percent, 0.0 until the first impression lands
    created_at: datetime
    updated_at: datetime


class ReorderIn(BaseModel):
    """Banner ids in their new display order (drag-to-reorder)."""

    ids: list[int] = Field(min_length=1, max_length=100)


class TrackEvent(BaseModel):
    id: int
    type: Literal["impression", "click"]


class TrackIn(BaseModel):
    """A batch of analytics events (one POST per page, not one per view)."""

    events: list[TrackEvent] = Field(min_length=1, max_length=50)


class TrackOut(BaseModel):
    accepted: int


class UploadOut(BaseModel):
    image_desktop: str
    image_mobile: str
