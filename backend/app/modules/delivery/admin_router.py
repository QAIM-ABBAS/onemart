"""Staff delivery management: zones CRUD, weekly templates, slot generation,
blocked dates, and today's delivery board."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_staff
from app.core.pagination import Page, PaginationParams
from app.modules.delivery import admin_service
from app.modules.delivery import service as delivery_service
from app.modules.delivery.schemas import (
    BlockDateIn,
    BlockedDateOut,
    BoardOut,
    GenerateIn,
    SlotOut,
    TemplateOut,
    TemplateWrite,
    ZoneOut,
    ZoneWrite,
)
from app.modules.users.models import User

router = APIRouter(prefix="/admin/delivery", tags=["admin-delivery"])

ZoneSort = Literal["newest", "oldest", "name"]


@router.get("/zones", response_model=Page[ZoneOut])
def admin_zones(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: ZoneSort = "newest",
    q: str | None = Query(None, max_length=120),
    is_active: bool | None = None,
):
    params = PaginationParams(page=page, page_size=page_size, sort=sort)
    return admin_service.list_zones(db, params, q=q, is_active=is_active)


@router.post("/zones", response_model=ZoneOut, status_code=201)
def admin_create_zone(
    payload: ZoneWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    zone = admin_service.create_zone(db, payload)
    db.commit()
    return ZoneOut.model_validate(zone)


@router.get("/zones/{zone_id}", response_model=ZoneOut)
def admin_zone(
    zone_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    return ZoneOut.model_validate(admin_service.get_zone(db, zone_id))


@router.patch("/zones/{zone_id}", response_model=ZoneOut)
def admin_update_zone(
    zone_id: int,
    payload: ZoneWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    zone = admin_service.get_zone(db, zone_id)
    admin_service.update_zone(db, zone, payload)
    db.commit()
    return ZoneOut.model_validate(zone)


@router.delete("/zones/{zone_id}", status_code=204)
def admin_delete_zone(
    zone_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    zone = admin_service.get_zone(db, zone_id)
    # Slots/templates/blocked dates cascade; orders keep a fee snapshot and
    # a SET NULL reference, so history never breaks.
    db.delete(zone)
    db.commit()
    return Response(status_code=204)


# --------------------------------------------------------------------------
# Weekly templates + generation
# --------------------------------------------------------------------------
@router.get("/zones/{zone_id}/templates", response_model=list[TemplateOut])
def admin_templates(
    zone_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    admin_service.get_zone(db, zone_id)
    return admin_service.list_templates(db, zone_id)


@router.post("/zones/{zone_id}/templates", response_model=TemplateOut, status_code=201)
def admin_create_template(
    zone_id: int,
    payload: TemplateWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    admin_service.get_zone(db, zone_id)
    template = admin_service.create_template(db, zone_id, payload)
    db.commit()
    return template


@router.delete("/templates/{template_id}", status_code=204)
def admin_delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    admin_service.delete_template(db, template_id)
    db.commit()
    return Response(status_code=204)


@router.post("/zones/{zone_id}/generate")
def admin_generate_slots(
    zone_id: int,
    payload: GenerateIn,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    """Turn the weekly templates into concrete slots (idempotent, skips
    existing windows and blocked dates)."""
    admin_service.get_zone(db, zone_id)
    created = delivery_service.generate_slots(
        db, zone_id=zone_id, date_from=payload.date_from, days=payload.days
    )
    db.commit()
    return {"created": created}


# --------------------------------------------------------------------------
# Slots (paginated management view) + blocked dates
# --------------------------------------------------------------------------
@router.get("/zones/{zone_id}/slots", response_model=Page[SlotOut])
def admin_slots(
    zone_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    date_from: date | None = None,
    date_to: date | None = None,
    state: Literal["available", "limited", "full", "closed"] | None = None,
):
    admin_service.get_zone(db, zone_id)
    params = PaginationParams(page=page, page_size=page_size, sort="date")
    result = admin_service.slots_page(
        db, zone_id, params, date_from=date_from, date_to=date_to, state=state
    )
    return Page[SlotOut](
        items=[SlotOut(**row) for row in result.items],
        total=result.total,
        page=result.page,
        page_size=result.page_size,
        pages=result.pages,
    )


@router.get("/zones/{zone_id}/blocked-dates", response_model=list[BlockedDateOut])
def admin_blocked_dates(
    zone_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    admin_service.get_zone(db, zone_id)
    return admin_service.list_blocked_dates(db, zone_id)


@router.post("/zones/{zone_id}/blocked-dates", response_model=BlockedDateOut, status_code=201)
def admin_block_date(
    zone_id: int,
    payload: BlockDateIn,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    admin_service.get_zone(db, zone_id)
    delivery_service.block_date(
        db, zone_id=zone_id, blocked_date=payload.date, reason=payload.reason
    )
    db.commit()
    rows = admin_service.list_blocked_dates(db, zone_id)
    return next(r for r in rows if r.blocked_date == payload.date)


@router.post("/zones/{zone_id}/unblock-date", status_code=204)
def admin_unblock_date(
    zone_id: int,
    payload: BlockDateIn,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    admin_service.get_zone(db, zone_id)
    delivery_service.unblock_date(db, zone_id=zone_id, blocked_date=payload.date)
    db.commit()
    return Response(status_code=204)


# --------------------------------------------------------------------------
# Today's delivery board
# --------------------------------------------------------------------------
@router.get("/board", response_model=BoardOut)
def admin_board(
    board_date: date | None = Query(None, alias="date"),
    zone_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    """Orders for this zone grouped by slot window (plus active no-slot
    orders under "unscheduled"). Status changes go through the existing
    admin order-status endpoint — one cancellation path only."""
    from datetime import UTC, datetime

    admin_service.get_zone(db, zone_id)
    return admin_service.board(
        db, board_date=board_date or datetime.now(UTC).date(), zone_id=zone_id
    )
