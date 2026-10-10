"""Zone matching, delivery quotes, slot availability, and checkout booking.

Matching rules (deterministic, tested):

* only **active** zones participate;
* a postal-code prefix match beats a city match; among prefix matches the
  longest prefix wins (a "5600" zone beats a "560" zone for 560001);
* ties resolve to the lowest zone id;
* **no zones configured at all** means the store has not set delivery up yet
  (bootstrap mode): ``match_zone`` returns None and callers fall back to the
  legacy flat fee instead of blocking every order. When zones *do* exist but
  none matches the address, the address is unserviceable and checkout blocks.

**Lock order**: DeliverySlot rows are always locked *after* inventory rows
(and after the Order row on cancellation paths) — Inventory → DeliverySlot.
Never take a slot lock and then an inventory lock.

Booking (``book_slot``) increments ``booked_count`` under SELECT ... FOR
UPDATE inside the caller's checkout transaction: of two customers racing for
the last seat exactly one wins; the loser gets a 409 and nothing is written.
"""

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import AppError, ConflictError, NotFoundError
from app.modules.delivery.models import (
    DELIVERY_METHODS,
    METHOD_EXPRESS,
    DeliveryBlockedDate,
    DeliverySlot,
    DeliverySlotTemplate,
    DeliveryZone,
)
from app.modules.discounts.pricing import DeliverySpec

# How many days ahead the checkout slot grid looks (admin generation goes further).
SLOT_HORIZON_DAYS = 14
# Widest window any caller may request (generation supports 60 days too).
SLOT_MAX_RANGE_DAYS = 60
# Below this many seats left a slot is shown as "limited".
LIMITED_REMAINING = 2

# Slot lifecycle states for the checkout grid.
STATE_AVAILABLE = "available"
STATE_LIMITED = "limited"
STATE_FULL = "full"
STATE_CLOSED = "closed"  # inside the cutoff window (or the date is blocked)


def zones_configured(db: Session) -> bool:
    """Has the store set up delivery at all? (See the module docstring.)"""
    return bool(db.scalar(select(DeliveryZone.id).where(DeliveryZone.is_active.is_(True)).limit(1)))


def active_zones(db: Session) -> list[DeliveryZone]:
    return list(
        db.scalars(
            select(DeliveryZone)
            .where(DeliveryZone.is_active.is_(True))
            .order_by(DeliveryZone.id)
        ).all()
    )


def _prefixes(zone: DeliveryZone) -> list[str]:
    return [
        str(p).strip()
        for p in (zone.postal_codes or [])
        if str(p).strip()
    ]


def _cities(zone: DeliveryZone) -> set[str]:
    return {str(c).strip().casefold() for c in (zone.cities or []) if str(c).strip()}


def match_zone(db: Session, *, postal_code: str | None, city: str | None) -> DeliveryZone | None:
    """The zone that serves this address, or None (unserviceable / not set up).

    Ranking: any postal-prefix match beats any city-only match; the longest
    winning prefix beats a shorter one; remaining ties go to the lowest id.
    """
    zones = active_zones(db)
    if not zones:
        return None

    pin = (postal_code or "").strip()
    city_key = (city or "").strip().casefold()

    best: DeliveryZone | None = None
    best_key: tuple[int, int, int] | None = None  # (by_postal, prefix_len, -zone_id)
    for zone in zones:
        prefix_len = 0
        if pin:
            for prefix in _prefixes(zone):
                if pin.startswith(prefix) and len(prefix) > prefix_len:
                    prefix_len = len(prefix)
        by_city = bool(city_key and city_key in _cities(zone))
        if prefix_len == 0 and not by_city:
            continue
        key = (1 if prefix_len else 0, prefix_len, -zone.id)
        if best_key is None or key > best_key:
            best_key, best = key, zone
    return best


def validate_method(method: str) -> str:
    if method not in DELIVERY_METHODS:
        raise AppError(f"Unknown delivery method '{method}'")
    return method


def delivery_spec(zone: DeliveryZone | None, method: str = "standard") -> DeliverySpec | None:
    """The money rules for this zone/method quote; ``None`` = no zone (the
    engine's store-wide default then applies)."""
    if zone is None:
        return None
    validate_method(method)
    fee = zone.express_fee if method == METHOD_EXPRESS else zone.base_fee
    return DeliverySpec(
        fee=fee,
        free_over=zone.free_delivery_threshold,
    )


def quote(
    db: Session, *, postal_code: str | None, city: str | None, method: str = "standard"
) -> tuple[DeliveryZone | None, DeliverySpec | None, bool]:
    """(zone, spec, serviceable) for an address.

    serviceable is True when a zone matched OR no zones are configured
    (bootstrap — the legacy flat fee keeps checkout working).
    """
    validate_method(method)
    zone = match_zone(db, postal_code=postal_code, city=city)
    if zone is None:
        return None, None, not zones_configured(db)
    return zone, delivery_spec(zone, method), True


# --------------------------------------------------------------------------
# Slots
# --------------------------------------------------------------------------
def cutoff_reached(slot_start: datetime, now: datetime | None = None) -> bool:
    now = now or datetime.now(UTC)
    cutoff = slot_start - timedelta(hours=settings.delivery_slot_cutoff_hours)
    return now >= cutoff


def _slot_start(slot: DeliverySlot) -> datetime:
    naive = datetime.combine(slot.slot_date, slot.start_time)
    return naive.replace(tzinfo=UTC)  # comparison basis; see settings note below


def slot_state(
    slot: DeliverySlot, *, blocked: bool, now: datetime | None = None
) -> str:
    if blocked or slot.booked_count >= slot.capacity:
        return STATE_CLOSED if blocked else STATE_FULL
    if cutoff_reached(_slot_start(slot), now):
        return STATE_CLOSED
    remaining = slot.capacity - slot.booked_count
    return STATE_LIMITED if remaining <= LIMITED_REMAINING else STATE_AVAILABLE


def blocked_dates(db: Session, zone_id: int, date_from: date, date_to: date) -> set[date]:
    rows = db.scalars(
        select(DeliveryBlockedDate.blocked_date).where(
            DeliveryBlockedDate.zone_id == zone_id,
            DeliveryBlockedDate.blocked_date >= date_from,
            DeliveryBlockedDate.blocked_date <= date_to,
        )
    ).all()
    return set(rows)


def list_slots(
    db: Session,
    zone_id: int,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    """Slots in the window with their checkout state (available/limited/full/closed).

    Reads are plain selects — the state is advisory; the booking decision
    always re-checks under the row lock inside checkout.
    """
    now = datetime.now(UTC)
    date_from = date_from or now.date()
    date_to = date_to or (date_from + timedelta(days=SLOT_HORIZON_DAYS))
    # Bounded like the generator (60 days max) — long enough for the admin
    # slot table, short enough that a request can't scan an unbounded range.
    if date_to > date_from + timedelta(days=SLOT_MAX_RANGE_DAYS):
        raise AppError("Slot range is too wide")

    zone = db.get(DeliveryZone, zone_id)
    if zone is None or not zone.is_active:
        raise NotFoundError("Delivery zone not found")

    slots = list(
        db.scalars(
            select(DeliverySlot)
            .where(
                DeliverySlot.zone_id == zone_id,
                DeliverySlot.slot_date >= date_from,
                DeliverySlot.slot_date <= date_to,
            )
            .order_by(DeliverySlot.slot_date, DeliverySlot.start_time)
        ).all()
    )
    blocked = blocked_dates(db, zone_id, date_from, date_to)
    return [
        {
            "id": slot.id,
            "date": slot.slot_date,
            "start": slot.start_time,
            "end": slot.end_time,
            "capacity": slot.capacity,
            "booked_count": slot.booked_count,
            # Blocked dates are dropped entirely (they never reach the grid);
            # `blocked` stays in the state machine for the booking path.
            "state": slot_state(slot, blocked=False, now=now),
        }
        for slot in slots
        if slot.slot_date not in blocked
    ]


def book_slot(db: Session, slot_id: int, *, now: datetime | None = None) -> DeliverySlot:
    """Claim one seat. Caller must already hold the transaction that will write
    the order (Inventory locks, if any, come first — see the module docstring).
    """
    now = now or datetime.now(UTC)
    slot = db.execute(
        select(DeliverySlot)
        .where(DeliverySlot.id == slot_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if slot is None:
        raise NotFoundError("That delivery slot no longer exists")

    blocked = db.scalar(
        select(DeliveryBlockedDate.id).where(
            DeliveryBlockedDate.zone_id == slot.zone_id,
            DeliveryBlockedDate.blocked_date == slot.slot_date,
        )
    )
    if blocked:
        raise ConflictError("That delivery date is no longer available")

    if cutoff_reached(_slot_start(slot), now):
        raise ConflictError("That slot is too close to its start time to book")
    if slot.booked_count >= slot.capacity:
        raise ConflictError("That slot is fully booked")

    slot.booked_count += 1
    return slot


def release_slot(db: Session, slot_id: int) -> None:
    """Free one seat (order cancelled). Conditional UPDATE: exactly one release
    per booking, and booked_count never goes negative even if raced."""
    db.execute(
        update(DeliverySlot)
        .where(DeliverySlot.id == slot_id, DeliverySlot.booked_count > 0)
        .values(booked_count=DeliverySlot.booked_count - 1)
        .execution_options(synchronize_session=False)
    )


def release_slot_for_order(db: Session, order) -> None:
    """The cancellation path: free the seat this order was holding, if any."""
    if order.delivery_slot_id is None:
        return
    release_slot(db, order.delivery_slot_id)


# --------------------------------------------------------------------------
# Admin: template generation and date blocking
# --------------------------------------------------------------------------
def generate_slots(
    db: Session, *, zone_id: int, date_from: date, days: int = SLOT_HORIZON_DAYS
) -> int:
    """Turn the weekly templates into concrete slots for ``days`` days.

    Idempotent: an existing (zone, date, start) window is skipped, and blocked
    dates are never generated. Returns how many slots were created.
    """
    if days < 1 or days > 60:
        raise AppError("Generate between 1 and 60 days at a time")
    zone = db.get(DeliveryZone, zone_id)
    if zone is None:
        raise NotFoundError("Delivery zone not found")

    templates = list(
        db.scalars(
            select(DeliverySlotTemplate).where(DeliverySlotTemplate.zone_id == zone_id)
        ).all()
    )
    if not templates:
        raise AppError("Add a weekly template before generating slots")

    date_to = date_from + timedelta(days=days - 1)
    blocked = blocked_dates(db, zone_id, date_from, date_to)
    existing = {
        (s.slot_date, s.start_time)
        for s in db.scalars(
            select(DeliverySlot).where(
                DeliverySlot.zone_id == zone_id,
                DeliverySlot.slot_date >= date_from,
                DeliverySlot.slot_date <= date_to,
            )
        ).all()
    }

    created = 0
    for offset in range(days):
        day = date_from + timedelta(days=offset)
        if day in blocked:
            continue
        for template in templates:
            if template.weekday != day.weekday():
                continue
            if (day, template.start_time) in existing:
                continue
            db.add(
                DeliverySlot(
                    zone_id=zone_id,
                    slot_date=day,
                    start_time=template.start_time,
                    end_time=template.end_time,
                    capacity=template.capacity,
                )
            )
            created += 1
    return created


def block_date(db: Session, *, zone_id: int, blocked_date: date, reason: str | None = None) -> None:
    if db.scalar(
        select(DeliveryBlockedDate.id).where(
            DeliveryBlockedDate.zone_id == zone_id,
            DeliveryBlockedDate.blocked_date == blocked_date,
        )
    ):
        raise ConflictError("That date is already blocked")
    db.add(
        DeliveryBlockedDate(zone_id=zone_id, blocked_date=blocked_date, reason=reason)
    )
    db.flush()


def unblock_date(db: Session, *, zone_id: int, blocked_date: date) -> None:
    row = db.scalar(
        select(DeliveryBlockedDate).where(
            DeliveryBlockedDate.zone_id == zone_id,
            DeliveryBlockedDate.blocked_date == blocked_date,
        )
    )
    if row is None:
        raise NotFoundError("That date is not blocked")
    db.delete(row)
    db.flush()
