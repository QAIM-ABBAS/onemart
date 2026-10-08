"""Background jobs that keep orders and stock honest.

The only scheduled job in Phase 1 is the reservation sweeper: an online order
whose payment window closed must give its stock back and stop existing as a
"pending" order. It runs every minute under Celery beat and is idempotent —
the ``active → released`` transition is conditional, so running it twice (or
overlapping runs) can never release the same units twice or cancel twice.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.celery_app import celery
from app.core.db import SessionLocal
from app.modules.inventory.reservations import (
    consume_for_order,
    expired_order_ids,
    release_for_order,
)
from app.modules.notifications import service as notifications_service
from app.modules.notifications.models import NotificationType
from app.modules.orders.models import Order, OrderStatus, OrderStatusHistory, PaymentStatus
from app.modules.payments.models import Payment, PaymentAttemptStatus

logger = logging.getLogger("onemart")


def _fail_open_attempts(db, order: Order) -> None:
    """Close every attempt that never reached the gateway's verdict."""
    attempts = db.scalars(
        select(Payment)
        .where(
            Payment.order_id == order.id,
            Payment.status.in_(
                [PaymentAttemptStatus.INITIATED, PaymentAttemptStatus.PENDING]
            ),
        )
        .with_for_update()
    ).all()
    for attempt in attempts:
        attempt.status = PaymentAttemptStatus.FAILED
        attempt.raw_response = {
            **(attempt.raw_response or {}),
            "expired": True,
            "at": datetime.now(UTC).isoformat(),
        }


def sweep_expired_reservations(db) -> dict:
    """Run against an open session; commits per order so one failure can't
    strand the rest of the batch."""
    order_ids = expired_order_ids(db)
    summary = {"scanned": len(order_ids), "released": 0, "cancelled": 0, "consumed": 0}

    for order_id in order_ids:
        try:
            # App-wide lock order starts at the Order row.
            order = db.execute(
                select(Order).where(Order.id == order_id).with_for_update()
            ).scalar_one_or_none()
            if order is None:
                continue

            if order.status == OrderStatus.CANCELLED:
                # Already gone: clear any hold a racing cancel left behind.
                release_for_order(db, order)
                db.commit()
                continue

            if order.status != OrderStatus.PENDING or order.payment_status == PaymentStatus.PAID:
                # The callback won the race and verified the payment: the hold
                # becomes real stock instead of vanishing.
                summary["consumed"] += consume_for_order(db, order)
                db.commit()
                continue

            released = release_for_order(db, order)
            _fail_open_attempts(db, order)
            order.status = OrderStatus.CANCELLED
            order.payment_status = PaymentStatus.FAILED
            db.add(
                OrderStatusHistory(
                    order=order,
                    status=OrderStatus.CANCELLED,
                    note="Payment timeout",
                )
            )
            notifications_service.notify(
                db,
                user_id=order.user_id,
                type=NotificationType.ORDER_CANCELLED,
                title=f"Order {order.order_number} was cancelled",
                body=(
                    "We could not receive your payment in time, so the order was "
                    "cancelled and your items are available again. You can order "
                    "them any time."
                ),
                link=f"/orders/{order.id}",
            )
            db.commit()
            summary["released"] += released
            summary["cancelled"] += 1
        except Exception:
            db.rollback()
            logger.exception("reservation sweep failed for order %s", order_id)

    return summary


@celery.task(name="orders.release_expired_reservations")
def release_expired_reservations() -> dict:
    """Celery beat entry point (every minute)."""
    with SessionLocal() as db:
        return sweep_expired_reservations(db)
