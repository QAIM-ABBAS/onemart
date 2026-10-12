"""Public banner payloads and the batched analytics inbox.

Two responsibilities, deliberately kept away from the admin side:

* :func:`active_payload` — what a storefront component renders for a
  placement: only banners that are on **and** in-window, ordered by
  priority, capped per placement (a five-slide hero carousel, one creative
  for every other strip — the homepage never stacks promos). The result is
  cached for 60s and dropped the moment staff change anything. CTAs are
  resolved to a storefront ``href`` at build time, so a renamed product
  slug or coupon code cannot leave a dead banner behind.

* :func:`track_events` — the light analytics inbox. Clients batch events
  into one POST; the endpoint rate-limits per client, dedupes impressions
  (one per banner per client per dedup window) and buffers counts in Redis
  under ``bstats:*``. Nothing here writes to Postgres — :func:`flush_stats`
  drains the buffer into the counters once a minute via Celery, which is
  why the admin CTR column is at most a minute stale (plus the live
  pending peek the admin list adds on top).
"""

import json
from datetime import UTC, datetime

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import RateLimitedError
from app.core.redis import (
    cache_delete_prefix,
    cache_get,
    cache_incr,
    cache_set,
    cache_set_nx,
    counter_incr,
    counter_peek,
    counter_take_prefix,
)
from app.modules.banners.models import Banner, BannerPlacement
from app.modules.banners.schemas import TrackIn
from app.modules.catalog.models import Product
from app.modules.discounts.models import Coupon

__all__ = [
    "active_payload",
    "flush_stats",
    "invalidate_banners_cache",
    "pending_stats",
    "track_events",
]

# How many creatives a placement may show: a five-slide carousel for the
# hero, one creative for every other strip. This is the homepage rule
# ("prominent but not cluttered") enforced server-side.
PLACEMENT_CAPS: dict[str, int] = {
    BannerPlacement.HOME_HERO.value: 5,
    BannerPlacement.HOME_MID_STRIP.value: 1,
    BannerPlacement.CATEGORY_HEADER.value: 1,
    BannerPlacement.CART_PROMO.value: 1,
}

_PAYLOAD_PREFIX = "banners:pl:"
_RATE_PREFIX = "banners:rl:"
_DEDUP_PREFIX = "banners:imp:"
_COUNTER_PREFIX = "bstats:"


def invalidate_banners_cache() -> None:
    cache_delete_prefix(_PAYLOAD_PREFIX)


def active_payload(
    db: Session, placement: str, *, category_slug: str | None = None
) -> list[dict]:
    """JSON-ready banners for one placement (empty list = hide the slot)."""
    category_key = (category_slug or "-").strip() or "-"
    key = f"{_PAYLOAD_PREFIX}{placement}:{category_key}"
    raw = cache_get(key)
    if raw is not None:
        return json.loads(raw)

    payload = _build_payload(db, placement, category_key)
    cache_set(key, json.dumps(payload), settings.banner_cache_ttl)
    return payload


def _build_payload(db: Session, placement: str, category_key: str) -> list[dict]:
    now = datetime.now(UTC)
    try:
        placement_enum = BannerPlacement(placement)
    except ValueError:
        return []  # unknown placement — validated at the router, belt and braces
    cap = PLACEMENT_CAPS[placement_enum.value]

    filters = [
        Banner.placement == placement_enum,
        Banner.is_active.is_(True),
        or_(Banner.starts_at.is_(None), Banner.starts_at <= now),
        or_(Banner.ends_at.is_(None), Banner.ends_at > now),
    ]

    if placement_enum == BannerPlacement.CATEGORY_HEADER:
        if category_key == "-":
            return []  # a category header without a category shows nothing
        from app.modules.catalog.models import Category

        filters.append(
            Banner.category_id.in_(
                select(Category.id).where(Category.slug == category_key)
            )
        )

    rows = db.scalars(
        select(Banner)
        .where(*filters)
        .order_by(Banner.priority.asc(), Banner.id.asc())
        .limit(cap)
    ).all()
    return [_out(db, banner, placement) for banner in rows]


def _out(db: Session, banner: Banner, placement: str) -> dict:
    return {
        "id": banner.id,
        "title": banner.title,
        "eyebrow": banner.eyebrow,
        "subtitle": banner.subtitle,
        "cta_label": banner.cta_label,
        "tone": banner.tone,
        "image_desktop": banner.image_desktop,
        "image_mobile": banner.image_mobile,
        "alt": banner.alt or banner.title,
        "placement": placement,
        "link_type": banner.link_type.value,
        "link_target": banner.link_target,
        "href": resolve_href(db, banner),
    }


def resolve_href(db: Session, banner: Banner) -> str:
    """The storefront route this banner's CTA opens.

    Internal link types are resolved against live rows (products/categories
    can be renamed, coupons retired) and degrade to the catalogue root when
    the target is gone — a banner never404s the shopper.
    """
    target = (banner.link_target or "").strip()
    kind = banner.link_type.value

    if kind == "url":
        return target or "/products"
    if kind == "product":
        slug = _resolve_slug(db, Product, target)
        return f"/p/{slug}" if slug else "/products"
    if kind == "category":
        from app.modules.catalog.models import Category

        slug = _resolve_slug(db, Category, target)
        return f"/products?category={slug}" if slug else "/products"
    if kind == "coupon":
        code = target.upper()
        exists = db.scalar(
            select(Coupon.id).where(func.upper(Coupon.code) == code)
        )
        return f"/cart?coupon={code}" if exists else "/products"
    return "/products"


def _resolve_slug(db: Session, model, target: str) -> str | None:
    """slug first, numeric id as a fallback (admins may paste either)."""
    if not target:
        return None
    slug = db.scalar(select(model.slug).where(model.slug == target))
    if slug is not None:
        return slug
    if target.isdigit():
        return db.scalar(select(model.slug).where(model.id == int(target)))
    return None


# --------------------------------------------------------------------------
# Analytics inbox (rate-limited → deduped → buffered; Postgres untouched)
# --------------------------------------------------------------------------


def track_events(db: Session, payload: TrackIn, client_ip: str) -> int:
    """Accept a batch of impression/click events. Returns how many were
    counted (unknown banner ids and repeat impressions are silently
    dropped); raises 429 when a client floods the endpoint."""
    events = payload.events
    rate = cache_incr(f"{_RATE_PREFIX}{client_ip}", 60, amount=len(events))
    if rate > settings.banner_track_rate_limit:
        raise RateLimitedError("Too many banner events — slow down")

    known = set(
        db.scalars(select(Banner.id).where(Banner.id.in_({e.id for e in events})))
    )

    accepted = 0
    for event in events:
        if event.id not in known:
            continue
        if event.type == "impression":
            # One impression per banner per client per dedup window: a
            # refresh-happy visitor doesn't inflate the CTR.
            first = cache_set_nx(
                f"{_DEDUP_PREFIX}{client_ip}:{event.id}",
                "1",
                settings.banner_impression_dedup_seconds,
            )
            if not first:
                continue
            counter_incr(f"{_COUNTER_PREFIX}{event.id}:imp")
        else:
            counter_incr(f"{_COUNTER_PREFIX}{event.id}:clk")
        accepted += 1
    return accepted


def pending_stats(db: Session, banner_ids: list[int]) -> dict[int, tuple[int, int]]:
    """Buffered (impressions, clicks) not yet flushed to Postgres — the
    admin list merges these on top of the stored counters so staff see
    activity within seconds of it happening."""
    out: dict[int, tuple[int, int]] = {}
    for banner_id in banner_ids:
        imp = counter_peek(f"{_COUNTER_PREFIX}{banner_id}:imp")
        clk = counter_peek(f"{_COUNTER_PREFIX}{banner_id}:clk")
        if imp or clk:
            out[banner_id] = (imp, clk)
    return out


def flush_stats(db: Session) -> int:
    """Drain the Redis buffer into the banners table (Celery beat, every
    minute). Drain-then-update: counters for a banner deleted mid-window
    are dropped with it instead of leaking keys forever."""
    drained = counter_take_prefix(_COUNTER_PREFIX)
    per_banner: dict[int, dict[str, int]] = {}
    for key, value in drained.items():
        # key shape: bstats:{banner_id}:{imp|clk}
        parts = key.split(":")
        if len(parts) != 3 or value <= 0:
            continue
        try:
            banner_id = int(parts[1])
        except ValueError:
            continue
        slot = per_banner.setdefault(banner_id, {"imp": 0, "clk": 0})
        if parts[2] == "imp":
            slot["imp"] += value
        elif parts[2] == "clk":
            slot["clk"] += value

    updated = 0
    for banner_id, counts in per_banner.items():
        result = db.execute(
            update(Banner)
            .where(Banner.id == banner_id)
            .values(
                impressions=Banner.impressions + counts["imp"],
                clicks=Banner.clicks + counts["clk"],
            )
            .execution_options(synchronize_session=False)
        )
        updated += int(result.rowcount or 0)
    if updated:
        db.commit()
    return updated
