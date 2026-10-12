"""Public banner endpoints: one payload per placement + the analytics inbox."""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.modules.banners.schemas import BannerOut, TrackIn, TrackOut
from app.modules.banners.service import active_payload, track_events

router = APIRouter(prefix="/banners", tags=["banners"])

Placement = Literal["home_hero", "home_mid_strip", "category_header", "cart_promo"]


@router.get("", response_model=list[BannerOut])
def list_banners(
    placement: Placement = Query(...),
    category: str | None = Query(None, max_length=100),
    db: Session = Depends(get_db),
):
    """Active, in-window banners for one placement, highest priority first.

    An empty list is the "hide this slot" signal — components show their
    skeleton while loading and render nothing at all once it lands, so an
    unbooked slot never leaves an empty header behind. ``category`` narrows
    ``category_header`` to one category's banner.
    """
    return active_payload(db, placement, category_slug=category)


@router.post("/track", response_model=TrackOut)
def track(payload: TrackIn, request: Request, db: Session = Depends(get_db)):
    """Batched, rate-limited impression/click inbox — buffered in Redis and
    flushed to Postgres by Celery, never written per view."""
    client = request.client
    # Behind a proxy this is the proxy's address; proxy-aware client IPs
    # arrive with the Phase 7 hardening pass.
    return TrackOut(accepted=track_events(db, payload, client.host if client else "unknown"))
