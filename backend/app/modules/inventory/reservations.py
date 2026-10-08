"""Stock reservation lifecycle.

A reservation is a hold written in the same transaction that locked the
inventory row, so "how much can I buy" and "how much is held" can never be read
at different moments. ``Inventory.reserved`` is the running total of the
*active* holds on that variant — every availability read in the app
(product pages, cart, checkout, reports) already goes through
``quantity - reserved``, so honouring reservations is just keeping that counter
honest.

**Lock order** (deadlock avoidance, same everywhere): Order → Inventory →
StockReservation. Callers must already hold the Order lock before calling
``consume_for_order`` / ``release_for_order``.
"""

from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.modules.inventory.models import Inventory, ReservationStatus, StockReservation
from app.modules.orders.models import Order

ACTIVE = ReservationStatus.ACTIVE


def lock_inventory(db: Session, variant_ids: list[int]) -> dict[int, Inventory]:
    """Lock (and refresh) the inventory rows for these variants, in id order."""
    if not variant_ids:
        return {}
    rows = db.execute(
        select(Inventory)
        .where(Inventory.variant_id.in_(variant_ids))
        .order_by(Inventory.variant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalars()
    return {row.variant_id: row for row in rows}


def lock_active_reservations(db: Session, order_id: int) -> list[StockReservation]:
    return list(
        db.execute(
            select(StockReservation)
            .where(StockReservation.order_id == order_id, StockReservation.status == ACTIVE)
            .order_by(StockReservation.variant_id, StockReservation.id)
            .with_for_update()
        )
        .scalars()
    )


def _flip(db: Session, reservation: StockReservation, to: ReservationStatus) -> bool:
    """Conditional ACTIVE → ``to`` transition: exactly one caller can win, even
    if some future path forgets to take the order lock first."""
    result = db.execute(
        update(StockReservation)
        .where(StockReservation.id == reservation.id, StockReservation.status == ACTIVE)
        .values(status=to)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount:
        reservation.status = to
        return True
    return False


def consume_for_order(db: Session, order: Order) -> int:
    """Money arrived: turn the holds into real stock movement.

    ``quantity`` goes down (the units leave the shelf) and ``reserved`` goes
    down by the same amount, so ``available`` is unchanged by the conversion.
    Returns the number of units consumed.
    """
    reservations = lock_active_reservations(db, order.id)
    if not reservations:
        return 0
    inventory = lock_inventory(db, sorted({r.variant_id for r in reservations}))
    consumed = 0
    for reservation in reservations:
        if not _flip(db, reservation, ReservationStatus.CONSUMED):
            continue
        row = inventory.get(reservation.variant_id)
        if row is not None:
            row.quantity -= reservation.qty
            row.reserved = max(row.reserved - reservation.qty, 0)
        consumed += reservation.qty
    return consumed


def release_for_order(db: Session, order: Order) -> int:
    """Drop the holds (timeout / cancellation before payment): ``quantity`` is
    untouched — it never moved — only ``reserved`` shrinks. Returns the units."""
    reservations = lock_active_reservations(db, order.id)
    if not reservations:
        return 0
    inventory = lock_inventory(db, sorted({r.variant_id for r in reservations}))
    released = 0
    for reservation in reservations:
        if not _flip(db, reservation, ReservationStatus.RELEASED):
            continue
        row = inventory.get(reservation.variant_id)
        if row is not None:
            row.reserved = max(row.reserved - reservation.qty, 0)
        released += reservation.qty
    return released


def restock_consumed_for_order(db: Session, order: Order) -> int:
    """Undo an already-consumed hold (COD order cancelled before delivery):
    put the units back on the shelf."""
    rows = list(
        db.execute(
            select(StockReservation)
            .where(
                StockReservation.order_id == order.id,
                StockReservation.status == ReservationStatus.CONSUMED,
            )
            .order_by(StockReservation.variant_id, StockReservation.id)
            .with_for_update()
        )
        .scalars()
    )
    by_variant = {r.variant_id: r for r in rows}
    inventory = lock_inventory(db, sorted(by_variant))
    restocked = 0
    for reservation in rows:
        result = db.execute(
            update(StockReservation)
            .where(
                StockReservation.id == reservation.id,
                StockReservation.status == ReservationStatus.CONSUMED,
            )
            .values(status=ReservationStatus.RELEASED)
            .execution_options(synchronize_session=False)
        )
        if not result.rowcount:
            continue
        reservation.status = ReservationStatus.RELEASED
        row = inventory.get(reservation.variant_id)
        if row is not None:
            row.quantity += reservation.qty
        restocked += reservation.qty
    return restocked


def restock_order(db: Session, order: Order) -> int:
    """Full restock for a cancelled order: release what is still held, and
    shelve again what a COD/verified payment already took.

    Orders that predate reservations (no rows at all) fall back to the legacy
    behaviour of adding the quantities straight back.
    """
    reservations = lock_active_reservations(db, order.id)
    released = release_for_order(db, order) if reservations else 0
    restocked = restock_consumed_for_order(db, order)
    if not reservations and not restocked:
        # Legacy path: no reservation rows (old order or a non-reserving flow).
        variant_ids = sorted({i.variant_id for i in order.items if i.variant_id is not None})
        inventory = lock_inventory(db, variant_ids)
        for item in order.items:
            if item.variant_id is None:
                continue
            row = inventory.get(item.variant_id)
            if row is not None:
                row.quantity += item.quantity
        return sum(i.quantity for i in order.items)
    return released + restocked


def expired_order_ids(db: Session, now: datetime | None = None) -> list[int]:
    """Orders holding at least one expired reservation — no locks taken, this
    is only the candidate list; the caller locks each order before acting."""
    now = now or datetime.now(UTC)
    rows = db.execute(
        select(StockReservation.order_id)
        .where(StockReservation.status == ACTIVE, StockReservation.expires_at <= now)
        .distinct()
    ).all()
    return [row[0] for row in rows]
