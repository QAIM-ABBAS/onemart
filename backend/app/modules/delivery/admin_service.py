"""Admin-side delivery work: zone CRUD, templates, slot pages, today's board.

The booking primitives (generate_slots, block/unblock, list_slots) live in
:mod:`.service` because checkout and the public grid use them too; this file
only adds the staff-facing list/CRUD shapes on top.
"""

from datetime import UTC, datetime, timedelta
from datetime import date as date_type

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.core.pagination import Page, PaginationParams
from app.modules.delivery import service as delivery_service
from app.modules.delivery.models import (
    DeliveryBlockedDate,
    DeliverySlot,
    DeliverySlotTemplate,
    DeliveryZone,
)
from app.modules.delivery.schemas import (
    BoardEntry,
    BoardGroup,
    BoardOut,
    TemplateWrite,
    ZoneOut,
    ZoneWrite,
)
from app.modules.orders.models import Order, OrderStatus


def get_zone(db: Session, zone_id: int) -> DeliveryZone:
    zone = db.get(DeliveryZone, zone_id)
    if zone is None:
        raise NotFoundError("Delivery zone not found")
    return zone


def list_zones(
    db: Session,
    params: PaginationParams,
    *,
    q: str | None = None,
    is_active: bool | None = None,
) -> Page[ZoneOut]:
    filters = []
    if q:
        needle = f"%{q.strip()}%"
        filters.append(DeliveryZone.name.ilike(needle))
    if is_active is not None:
        filters.append(DeliveryZone.is_active.is_(is_active))

    total = db.execute(select(func.count()).select_from(DeliveryZone).where(*filters)).scalar_one()
    sort_map = {
        "newest": DeliveryZone.id.desc(),
        "oldest": DeliveryZone.id.asc(),
        "name": DeliveryZone.name.asc(),
    }
    rows = db.scalars(
        select(DeliveryZone)
        .where(*filters)
        .order_by(sort_map.get(params.sort, sort_map["newest"]), DeliveryZone.id.desc())
        .offset(params.offset)
        .limit(params.page_size)
    ).unique().all()

    pages = max((total + params.page_size - 1) // params.page_size, 1) if total else 1
    return Page[ZoneOut](
        items=[ZoneOut.model_validate(z) for z in rows],
        total=total,
        page=params.page,
        page_size=params.page_size,
        pages=pages,
    )


def create_zone(db: Session, payload: ZoneWrite) -> DeliveryZone:
    zone = DeliveryZone(
        name=payload.name,
        postal_codes=payload.postal_codes,
        cities=payload.cities,
        base_fee=payload.base_fee,
        express_fee=payload.express_fee,
        free_delivery_threshold=payload.free_delivery_threshold,
        is_active=payload.is_active,
    )
    db.add(zone)
    db.flush()
    return zone


def update_zone(db: Session, zone: DeliveryZone, payload: ZoneWrite) -> DeliveryZone:
    zone.name = payload.name
    zone.postal_codes = payload.postal_codes
    zone.cities = payload.cities
    zone.base_fee = payload.base_fee
    zone.express_fee = payload.express_fee
    zone.free_delivery_threshold = payload.free_delivery_threshold
    zone.is_active = payload.is_active
    db.flush()
    return zone


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------
def list_templates(db: Session, zone_id: int) -> list[DeliverySlotTemplate]:
    return list(
        db.scalars(
            select(DeliverySlotTemplate)
            .where(DeliverySlotTemplate.zone_id == zone_id)
            .order_by(DeliverySlotTemplate.weekday, DeliverySlotTemplate.start_time)
        ).all()
    )


def create_template(db: Session, zone_id: int, payload: TemplateWrite) -> DeliverySlotTemplate:
    existing = db.scalar(
        select(DeliverySlotTemplate.id).where(
            DeliverySlotTemplate.zone_id == zone_id,
            DeliverySlotTemplate.weekday == payload.weekday,
            DeliverySlotTemplate.start_time == payload.start_time,
        )
    )
    if existing is not None:
        raise ConflictError("That weekly window already exists for this zone")
    template = DeliverySlotTemplate(
        zone_id=zone_id,
        weekday=payload.weekday,
        start_time=payload.start_time,
        end_time=payload.end_time,
        capacity=payload.capacity,
    )
    db.add(template)
    db.flush()
    return template


def delete_template(db: Session, template_id: int) -> None:
    template = db.get(DeliverySlotTemplate, template_id)
    if template is None:
        raise NotFoundError("Template not found")
    db.delete(template)
    db.flush()


# --------------------------------------------------------------------------
# Slots (admin page view) + blocked dates
# --------------------------------------------------------------------------
def slots_page(
    db: Session,
    zone_id: int,
    params: PaginationParams,
    *,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    state: str | None = None,
) -> Page[dict]:
    """Paginated slot table for the admin screen (state filter applied after
    the bookability computation, which needs the cutoff/blocked context)."""
    date_from = date_from or datetime.now(UTC).date()
    date_to = date_to or (date_from + timedelta(days=60))
    rows = delivery_service.list_slots(db, zone_id, date_from=date_from, date_to=date_to)
    if state:
        rows = [r for r in rows if r["state"] == state]
    total = len(rows)
    start = params.offset
    page_rows = rows[start : start + params.page_size]
    pages = max((total + params.page_size - 1) // params.page_size, 1) if total else 1
    return Page[dict](
        items=page_rows,
        total=total,
        page=params.page,
        page_size=params.page_size,
        pages=pages,
    )


def list_blocked_dates(db: Session, zone_id: int) -> list[DeliveryBlockedDate]:
    return list(
        db.scalars(
            select(DeliveryBlockedDate)
            .where(DeliveryBlockedDate.zone_id == zone_id)
            .order_by(DeliveryBlockedDate.blocked_date)
        ).all()
    )


# --------------------------------------------------------------------------
# Today's delivery board
# --------------------------------------------------------------------------
_ACTIVE = (
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PACKED,
    OrderStatus.SHIPPED,
)


def board(db: Session, *, board_date: date_type, zone_id: int) -> BoardOut:
    """Orders touching this zone on this date: scheduled ones grouped by their
    slot window, active no-slot ones under "unscheduled"."""
    slot_ids = [
        row[0]
        for row in db.execute(
            select(DeliverySlot.id).where(
                DeliverySlot.zone_id == zone_id, DeliverySlot.slot_date == board_date
            )
        ).all()
    ]

    def entry(order: Order, slot: DeliverySlot | None) -> BoardEntry:
        address = order.line1 + (f", {order.line2}" if order.line2 else "")
        return BoardEntry(
            order_id=order.id,
            order_number=order.order_number,
            status=order.status.value,
            recipient_name=order.recipient_name,
            phone=order.phone,
            address=f"{address}, {order.city} {order.postal_code}",
            slot_id=slot.id if slot else None,
            slot_start=slot.start_time if slot else None,
            slot_end=slot.end_time if slot else None,
            method=order.delivery_method,
            total=float(order.total),
            payment_status=order.payment_status.value,
        )

    groups: list[BoardGroup] = []
    if slot_ids:
        orders = db.scalars(
            select(Order)
            .where(Order.delivery_slot_id.in_(slot_ids))
            .order_by(Order.delivery_slot_id, Order.id)
        ).all()
        by_slot: dict[int, list[BoardEntry]] = {}
        slots = {
            s.id: s for s in db.scalars(select(DeliverySlot).where(DeliverySlot.id.in_(slot_ids)))
        }
        for order in orders:
            slot = slots.get(order.delivery_slot_id)
            if slot is None:
                continue
            by_slot.setdefault(slot.id, []).append(entry(order, slot))
        for slot_id in sorted(by_slot):
            slot = slots[slot_id]
            groups.append(
                BoardGroup(
                    slot_id=slot.id,
                    start=slot.start_time,
                    end=slot.end_time,
                    orders=by_slot[slot_id],
                )
            )

    unscheduled_rows = db.scalars(
        select(Order)
        .where(
            Order.delivery_zone_id == zone_id,
            Order.delivery_slot_id.is_(None),
            Order.status.in_(_ACTIVE),
        )
        .order_by(Order.id)
    ).all()
    unscheduled = [entry(order, None) for order in unscheduled_rows]

    return BoardOut(date=board_date, zone_id=zone_id, unscheduled=unscheduled, groups=groups)


__all__ = [
    "board",
    "create_template",
    "create_zone",
    "delete_template",
    "get_zone",
    "list_blocked_dates",
    "list_templates",
    "list_zones",
    "slots_page",
    "update_zone",
]
