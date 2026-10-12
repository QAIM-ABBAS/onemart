"""Admin-side banner work: CRUD, scheduling rules, drag-to-reorder.

The public payload and analytics live in :mod:`.service`; this file only
adds the staff-facing shapes and keeps the shared payload cache honest
after every change.
"""

from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ConflictError, NotFoundError
from app.core.pagination import Page, PaginationParams
from app.modules.banners.models import Banner, BannerPlacement
from app.modules.banners.schemas import BannerAdminOut, BannerWrite, ReorderIn
from app.modules.banners.service import (
    PLACEMENT_CAPS,
    invalidate_banners_cache,
    pending_stats,
    resolve_href,
)
from app.modules.catalog.models import Category, Product
from app.modules.discounts.admin_service import status_of
from app.modules.discounts.models import Coupon

# The hero carousel may hold this many active creatives at once.
_HERO_MAX = PLACEMENT_CAPS[BannerPlacement.HOME_HERO.value]


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _field_error(message: str, field: str) -> AppError:
    """A 400 the frontend attaches to the offending input (same details
    shape FastAPI uses for its own 422s)."""
    return AppError(message, details=[{"field": field, "message": message}])


def _status_clause(status: str):
    """SQL twin of ``status_of`` so filtering paginates correctly."""
    now = datetime.now(UTC)
    clauses = {
        "active": and_(
            Banner.is_active.is_(True),
            or_(Banner.starts_at.is_(None), Banner.starts_at <= now),
            or_(Banner.ends_at.is_(None), Banner.ends_at > now),
        ),
        "inactive": Banner.is_active.is_(False),
        "scheduled": and_(
            Banner.is_active.is_(True), Banner.starts_at.isnot(None), Banner.starts_at > now
        ),
        "expired": and_(
            Banner.is_active.is_(True), Banner.ends_at.isnot(None), Banner.ends_at <= now
        ),
    }
    return clauses[status]


def _pages(total: int, params: PaginationParams) -> int:
    if not total:
        return 1
    return max((total + params.page_size - 1) // params.page_size, 1)


def get_banner(db: Session, banner_id: int) -> Banner:
    banner = db.get(Banner, banner_id)
    if banner is None:
        raise NotFoundError("Banner not found")
    return banner


def admin_out(db: Session, banner: Banner, pending: dict[int, tuple[int, int]]) -> BannerAdminOut:
    out = BannerAdminOut.model_validate(banner, from_attributes=True)
    out.status = status_of(
        is_active=banner.is_active, starts_at=banner.starts_at, ends_at=banner.ends_at
    )
    extra_imp, extra_clk = pending.get(banner.id, (0, 0))
    out.impressions = banner.impressions + extra_imp
    out.clicks = banner.clicks + extra_clk
    # HUNDRED-first style guard: impressions may be zero while the buffer
    # still holds the first views — CTR stays 0.0 until a real denominator.
    out.ctr = round(out.clicks * 100.0 / out.impressions, 2) if out.impressions else 0.0
    out.category_name = banner.category.name if banner.category is not None else None
    return out


def list_banners(
    db: Session,
    params: PaginationParams,
    *,
    q: str | None = None,
    placement: str | None = None,
    status: str | None = None,
) -> Page[BannerAdminOut]:
    filters = []
    if q:
        filters.append(Banner.title.ilike(f"%{q.strip()}%"))
    if placement:
        filters.append(Banner.placement == BannerPlacement(placement))
    if status:
        filters.append(_status_clause(status))

    total = db.execute(
        select(func.count()).select_from(Banner).where(*filters)
    ).scalar_one()

    sort_map = {
        "priority": (Banner.priority.asc(), Banner.id.asc()),
        "newest": (Banner.created_at.desc(),),
        "oldest": (Banner.created_at.asc(),),
        "title": (Banner.title.asc(),),
        # NULLS LAST: banners with no impressions sort below every counted one.
        "ctr": (
            (Banner.clicks * 100.0 / func.nullif(Banner.impressions, 0)).desc().nulls_last(),
            Banner.id.desc(),
        ),
    }
    rows = db.scalars(
        select(Banner)
        .where(*filters)
        .order_by(*sort_map.get(params.sort, sort_map["priority"]))
        .offset(params.offset)
        .limit(params.page_size)
    ).all()

    pending = pending_stats(db, [banner.id for banner in rows])
    return Page[BannerAdminOut](
        items=[admin_out(db, banner, pending) for banner in rows],
        total=total,
        page=params.page,
        page_size=params.page_size,
        pages=_pages(total, params),
    )


def _validate(db: Session, payload: BannerWrite, *, banner: Banner | None = None) -> None:
    """Business rules the form hints at but the server must own."""
    placement = payload.placement.value

    # Category pairing: only a category header carries a category, and it
    # must exist (the table CHECK backs the first half up).
    if placement == BannerPlacement.CATEGORY_HEADER.value:
        if payload.category_id is None:
            raise _field_error("Pick the category this header shows on", "category_id")
        if db.get(Category, payload.category_id) is None:
            raise _field_error("That category no longer exists", "category_id")
    elif payload.category_id is not None:
        raise _field_error(
            "Only category-header banners point at a category", "category_id"
        )

    starts = _aware(payload.starts_at)
    ends = _aware(payload.ends_at)
    if starts is not None and ends is not None and ends <= starts:
        raise _field_error("End time must be after the start time", "ends_at")

    # The hero carousel holds five actives, max.
    if placement == BannerPlacement.HOME_HERO.value:
        now = datetime.now(UTC)
        count = db.execute(
            select(func.count())
            .select_from(Banner)
            .where(
                Banner.placement == BannerPlacement.HOME_HERO,
                Banner.is_active.is_(True),
                or_(Banner.ends_at.is_(None), Banner.ends_at > now),
                *([Banner.id != banner.id] if banner is not None else []),
            )
        ).scalar_one()
        will_run = payload.is_active and (ends is None or ends > now)
        if will_run and count >= _HERO_MAX:
            raise ConflictError(
                f"The home hero holds at most {_HERO_MAX} active banners — "
                "pause or delete one first"
            )

    # Link targets are text inputs; check them against live rows now so a
    # typo is caught at save time (the public payload still degrades safely
    # if the target disappears later).
    target = payload.link_target.strip()
    kind = payload.link_type.value
    if kind == "product":
        if not _slug_exists(db, Product, target):
            raise _field_error("No product matches that slug or id", "link_target")
    elif kind == "category":
        if not _slug_exists(db, Category, target):
            raise _field_error("No category matches that slug or id", "link_target")
    elif kind == "coupon":
        exists = db.scalar(
            select(Coupon.id).where(Coupon.code == target.upper())
        )
        if exists is None:
            raise _field_error(f"No coupon with the code {target.upper()}", "link_target")
    elif not (target.startswith("/") or target.startswith("http")):
        raise _field_error(
            "Links must start with / (site path) or http(s)://", "link_target"
        )

    for field, value in (
        ("image_desktop", payload.image_desktop),
        ("image_mobile", payload.image_mobile),
    ):
        if value and not (value.startswith("/") or value.startswith("http")):
            raise _field_error(
                "Images must be an uploaded file or a URL starting with / or http(s)://",
                field,
            )


def _slug_exists(db: Session, model, target: str) -> bool:
    if not target:
        return False
    if db.scalar(select(model.id).where(model.slug == target)) is not None:
        return True
    return target.isdigit() and (
        db.scalar(select(model.id).where(model.id == int(target))) is not None
    )


def create_banner(db: Session, payload: BannerWrite) -> Banner:
    _validate(db, payload)
    banner = Banner(**payload.model_dump())
    db.add(banner)
    db.flush()
    invalidate_banners_cache()
    return banner


def update_banner(db: Session, banner: Banner, payload: BannerWrite) -> Banner:
    _validate(db, payload, banner=banner)
    for key, value in payload.model_dump().items():
        setattr(banner, key, value)
    db.flush()
    invalidate_banners_cache()
    return banner


def delete_banner(db: Session, banner: Banner) -> None:
    db.delete(banner)
    db.flush()
    invalidate_banners_cache()


def reorder_banners(db: Session, payload: ReorderIn) -> list[Banner]:
    """Drag-to-reorder: the ids arrive in their new display order and get
    priorities 10, 20, 30 … so later inserts have room between them."""
    banners = db.scalars(
        select(Banner).where(Banner.id.in_(payload.ids))
    ).all()
    by_id = {banner.id: banner for banner in banners}
    missing = [i for i in payload.ids if i not in by_id]
    if missing:
        raise NotFoundError(f"Banner {missing[0]} no longer exists")

    ordered = [by_id[banner_id] for banner_id in payload.ids]
    for index, banner in enumerate(ordered):
        banner.priority = (index + 1) * 10
    db.flush()
    invalidate_banners_cache()
    return ordered


def preview_href(db: Session, banner: Banner) -> str:
    """The CTA target the storefront will use — shown in the edit dialog."""
    return resolve_href(db, banner)
