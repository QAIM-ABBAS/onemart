"""Payment attempts: initiate → verify → (refund).

Rules this module exists to guarantee:

* **Idempotent callbacks** — a callback is applied under the Order row lock and
  anything already ``paid``/``refunded`` is a no-op, so the gateway calling
  twice (or the customer refreshing the return URL) changes state once.
* **No trust in redirect parameters** — the amount handed to the gateway for
  verification is read from our own ``payments.amount``; the query string only
  ever supplies the reference (``Authority``), and even that must match the one
  we stored when the attempt was opened.
* **Stock only moves once** — consuming a reservation is a conditional
  ``active → consumed`` transition inside the callback's transaction.

Lock order: Order → Payment → Inventory → StockReservation.
"""

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.exceptions import AppError, ConflictError, NotFoundError
from app.core.pagination import Page, PaginationParams
from app.modules.inventory.models import ReservationStatus, StockReservation
from app.modules.inventory.reservations import consume_for_order
from app.modules.notifications import service as notifications_service
from app.modules.notifications.models import NotificationType
from app.modules.orders.models import Order, OrderStatus, OrderStatusHistory, PaymentStatus
from app.modules.orders.payment import payment_registry
from app.modules.payments.models import (
    TERMINAL_PAYMENT_STATUSES,
    Payment,
    PaymentAttemptStatus,
)
from app.modules.payments.schemas import PaymentAdminOut, PaymentAttemptOut, PaymentStatusOut

__all__ = [
    "create_attempt",
    "get_payment",
    "handle_callback",
    "initiate_attempt",
    "list_admin_payments",
    "refund_order_payments",
    "refund_payment",
    "status_out",
    "sync_order_payment_status",
]


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


# --------------------------------------------------------------------------
# Attempts
# --------------------------------------------------------------------------
def create_attempt(db: Session, order: Order, provider) -> Payment:
    """Open an attempt row inside the checkout transaction.

    COD records a pending attempt (the money arrives later, at the door);
    online records an ``initiated`` one that ``initiate_attempt`` promotes once
    the gateway answers.
    """
    payment = Payment(
        order_id=order.id,
        provider=provider.code,
        amount=order.total,
        currency=settings.payment_currency,
        status=(
            PaymentAttemptStatus.INITIATED
            if provider.is_online
            else PaymentAttemptStatus.PENDING
        ),
        provider_ref=(f"COD-{order.order_number}" if not provider.is_online else None),
        raw_response={},
    )
    db.add(payment)
    db.flush()
    return payment


def _active_reservation_count(db: Session, order_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(StockReservation)
            .where(
                StockReservation.order_id == order_id,
                StockReservation.status == ReservationStatus.ACTIVE,
            )
        )
        or 0
    )


def initiate_attempt(
    db: Session, order: Order, *, return_origin: str | None = None
) -> dict:
    """Send the customer to the gateway for an order that is still awaiting money.

    The attempt row is committed *before* the network call so a gateway failure
    still leaves a visible (failed) attempt in Admin > Payments, and the order
    stays Pending with a working "Retry payment".

    ``return_origin`` is the (already allowlist-validated) origin the customer's
    browser is on; it rides along on the attempt so the gateway's redirect can
    bring them back to the same host they left — otherwise a dev server on
    ``127.0.0.1`` would get a cookie for ``localhost`` and the result page
    would be signed out.
    """
    if order.status == OrderStatus.CANCELLED:
        raise ConflictError("This order was cancelled — place it again to pay")
    if order.status != OrderStatus.PENDING:
        raise ConflictError("This order is already confirmed")
    if order.payment_status == PaymentStatus.PAID:
        raise ConflictError("This order is already paid")

    provider = payment_registry.get(order.payment_method)
    if not provider.is_online:
        raise AppError("This order is paid on delivery")

    deadline = _aware(order.payment_deadline)
    if deadline is not None and _now() >= deadline:
        raise ConflictError("The payment window for this order has expired")
    if _active_reservation_count(db, order.id) == 0:
        raise ConflictError("The payment window for this order has expired")

    # Checkout already opened one attempt for this order; reuse it while it is
    # still untouched so a straight "pay now" doesn't leave a dead initiated row
    # behind. A retry after a failure opens a fresh one.
    payment = db.scalar(
        select(Payment)
        .where(
            Payment.order_id == order.id,
            Payment.status == PaymentAttemptStatus.INITIATED,
            Payment.provider == provider.code,
        )
        .order_by(Payment.id.desc())
    )
    if payment is None:
        payment = create_attempt(db, order, provider)
    # Persist the return origin on the attempt itself (the callback re-reads and
    # re-validates it) so it survives the raw_response writes below — and a
    # gateway call that dies mid-flight.
    prior = dict(payment.raw_response or {})
    if return_origin:
        prior["return_origin"] = return_origin
        payment.raw_response = prior
    callback_url = (
        f"{settings.api_public_url}/api/payments/callback?payment_id={payment.id}"
    )
    db.commit()  # the attempt exists even if the gateway call below fails

    try:
        start = provider.start_payment(
            order,
            payment.amount,
            callback_url=callback_url,
            description=f"OneMart order {order.order_number}",
        )
    except AppError as exc:
        payment.status = PaymentAttemptStatus.FAILED
        payment.raw_response = {**prior, "error": exc.message}
        db.commit()
        raise

    payment.provider_ref = start.authority
    payment.status = PaymentAttemptStatus.PENDING
    payment.raw_response = {**prior, "request": start.raw}
    order.payment_status = PaymentStatus.PENDING
    db.commit()

    return {
        "payment_id": payment.id,
        "order_id": order.id,
        "redirect_url": start.redirect_url,
        "status": payment.status.value,
        "amount": float(payment.amount),
        "currency": payment.currency,
        "expires_at": order.payment_deadline,
    }


# --------------------------------------------------------------------------
# Callback / verification
# --------------------------------------------------------------------------
def handle_callback(
    db: Session, *, payment_id: int, authority: str | None, status_hint: str | None = None
) -> PaymentStatusOut:
    """Verify a return from the gateway and apply exactly one state change.

    ``status_hint`` (the redirect's ``Status=OK``) is logged but never acted
    on: the verdict comes from ``verify_payment``, which asks the gateway and
    passes **our** amount.
    """
    probe = db.get(Payment, payment_id)
    if probe is None:
        raise NotFoundError("Payment not found")

    # Lock order first (app-wide order), then the payment row.
    order = db.execute(
        select(Order).where(Order.id == probe.order_id).with_for_update()
    ).scalar_one()
    payment = db.execute(
        select(Payment).where(Payment.id == payment_id).with_for_update()
    ).scalar_one()

    if payment.status in TERMINAL_PAYMENT_STATUSES:
        # Replay of a callback we already applied — report, change nothing.
        return status_out(db, payment, order, already_processed=True)

    if not authority:
        raise ConflictError("The gateway did not send a payment reference")
    if payment.provider_ref and authority != payment.provider_ref:
        raise ConflictError("This payment reference does not belong to this order")

    provider = payment_registry.get(payment.provider)
    outcome = provider.verify_payment(authority=authority, amount=payment.amount)

    raw = dict(payment.raw_response or {})
    raw["verify"] = outcome.raw
    raw["verify_code"] = outcome.code
    if status_hint is not None:
        raw["redirect_status"] = status_hint
    payment.raw_response = raw
    payment.provider_ref = authority

    if not outcome.ok:
        payment.status = PaymentAttemptStatus.FAILED
        if order.payment_status != PaymentStatus.PAID:
            order.payment_status = PaymentStatus.FAILED
        db.commit()
        return status_out(db, payment, order)

    payment.status = PaymentAttemptStatus.PAID
    payment.paid_at = _now()
    if outcome.reference:
        payment.raw_response = {**raw, "ref_id": outcome.reference}
    order.payment_status = PaymentStatus.PAID

    if order.status == OrderStatus.CANCELLED:
        # Money landed for an order we already gave up on: keep the payment
        # record truthful and put the refund in front of an admin.
        payment.raw_response = {
            **(payment.raw_response or {}),
            "note": "Paid after cancellation — refund required",
        }
        db.add(
            OrderStatusHistory(
                order=order,
                status=OrderStatus.CANCELLED,
                note="Payment received after cancellation — refund pending",
            )
        )
        notifications_service.notify(
            db,
            user_id=order.user_id,
            type=NotificationType.ORDER_CANCELLED,
            title=f"Order {order.order_number} payment received",
            body="We received your payment for a cancelled order. It is being refunded.",
            link=f"/orders/{order.id}",
        )
    else:
        consume_for_order(db, order)
        if order.status == OrderStatus.PENDING:
            order.status = OrderStatus.CONFIRMED
            db.add(
                OrderStatusHistory(
                    order=order,
                    status=OrderStatus.CONFIRMED,
                    note="Payment received",
                )
            )
            notifications_service.notify(
                db,
                user_id=order.user_id,
                type=NotificationType.ORDER_STATUS,
                title=f"Order {order.order_number} confirmed",
                body="We received your payment — your order is confirmed.",
                link=f"/orders/{order.id}",
            )
    db.commit()
    return status_out(db, payment, order)


def status_out(
    db: Session, payment: Payment, order: Order, *, already_processed: bool = False
) -> PaymentStatusOut:
    return PaymentStatusOut(
        payment_id=payment.id,
        order_id=order.id,
        order_number=order.order_number,
        status=payment.status.value,
        amount=float(payment.amount),
        currency=payment.currency,
        order_status=order.status.value,
        payment_deadline=order.payment_deadline,
        already_processed=already_processed,
    )


# --------------------------------------------------------------------------
# Capture / refund
# --------------------------------------------------------------------------
def mark_cod_captured(db: Session, order: Order) -> None:
    """COD delivery: the cash is in hand — the attempt becomes paid."""
    payment = _latest_attempt(db, order.id)
    if payment is None:
        return
    payment.status = PaymentAttemptStatus.PAID
    payment.paid_at = _now()
    payment.raw_response = {**(payment.raw_response or {}), "captured": "cash on delivery"}


def sync_order_payment_status(db: Session, order: Order) -> None:
    """Mirror the sum of the attempts onto the order row."""
    rows = list(
        db.execute(
            select(Payment)
            .where(Payment.order_id == order.id)
            .order_by(Payment.id)
            .with_for_update()
        ).scalars()
    )
    if not rows:
        return
    paid = [p for p in rows if p.status != PaymentAttemptStatus.INITIATED]
    if not paid:
        return
    total = sum((Decimal(p.amount) for p in paid), Decimal("0"))
    refunded = sum((Decimal(p.refunded_amount) for p in paid), Decimal("0"))
    if refunded <= 0:
        if any(p.status == PaymentAttemptStatus.PAID for p in paid):
            order.payment_status = PaymentStatus.PAID
        elif any(p.status == PaymentAttemptStatus.FAILED for p in paid):
            order.payment_status = PaymentStatus.FAILED
        # otherwise the latest state (pending/initiated) already stands
    elif refunded >= total:
        order.payment_status = PaymentStatus.REFUNDED
    else:
        order.payment_status = PaymentStatus.PARTIALLY_REFUNDED


def _latest_attempt(db: Session, order_id: int) -> Payment | None:
    return db.scalar(
        select(Payment)
        .where(Payment.order_id == order_id)
        .order_by(Payment.id.desc())
        .limit(1)
    )


def refund_payment(
    db: Session,
    payment: Payment,
    amount: Decimal | None = None,
    *,
    reason: str | None = None,
    manual: bool = False,
) -> Payment:
    """Refund (part of) one attempt. Caller holds the Order and Payment locks.

    ``manual=True`` or a provider without gateway refunds records the refund as
    bookkeeping; otherwise ``provider.refund()`` is called and a failure leaves
    the payment exactly as it was (the admin can retry or record manually).
    """
    if payment.status not in (
        PaymentAttemptStatus.PAID,
        PaymentAttemptStatus.PARTIALLY_REFUNDED,
    ):
        raise ConflictError("Only a paid payment can be refunded")

    remaining = Decimal(payment.amount) - Decimal(payment.refunded_amount)
    value = remaining if amount is None else Decimal(amount)
    if value <= 0:
        raise AppError("Refund amount must be greater than zero")
    if value > remaining:
        raise AppError(
            "Refund cannot exceed what was paid",
            details={"remaining": float(remaining)},
        )

    provider = payment_registry.get(payment.provider)
    raw = dict(payment.raw_response or {})
    if manual or not provider.supports_refund:
        raw["refund"] = {"manual": True, "amount": str(value), "reason": reason}
    else:
        order = db.get(Order, payment.order_id)
        if order is None:
            raise NotFoundError("Order not found")
        result = provider.refund(
            order, value, provider_ref=payment.provider_ref, reason=reason
        )
        raw["refund"] = {
            "manual": False,
            "amount": str(value),
            "reason": reason,
            "reference": result.reference,
            "message": result.message,
        }

    payment.refunded_amount = Decimal(payment.refunded_amount) + value
    payment.raw_response = raw
    payment.status = (
        PaymentAttemptStatus.REFUNDED
        if Decimal(payment.refunded_amount) >= Decimal(payment.amount)
        else PaymentAttemptStatus.PARTIALLY_REFUNDED
    )
    db.flush()

    order = db.get(Order, payment.order_id)
    if order is not None:
        sync_order_payment_status(db, order)
    return payment


def refund_order_payments(
    db: Session, order: Order, *, reason: str | None = None, manual: bool = False
) -> list[Payment]:
    """Refund whatever this order has already been paid (cancellation path).

    The caller holds the Order lock. A gateway failure does not stop the
    cancellation: the attempt stays paid, its ``refund_error`` is recorded, and
    Admin > Payments shows it for a retry.
    """
    rows = list(
        db.execute(
            select(Payment)
            .where(Payment.order_id == order.id)
            .order_by(Payment.id)
            .with_for_update()
        ).scalars()
    )
    refunded: list[Payment] = []
    for payment in rows:
        if payment.status not in (
            PaymentAttemptStatus.PAID,
            PaymentAttemptStatus.PARTIALLY_REFUNDED,
        ):
            continue
        remaining = Decimal(payment.amount) - Decimal(payment.refunded_amount)
        if remaining <= 0:
            continue
        try:
            refunded.append(
                refund_payment(db, payment, None, reason=reason, manual=manual)
            )
        except AppError as exc:
            payment.raw_response = {
                **(payment.raw_response or {}),
                "refund_error": exc.message,
            }
            db.flush()
    return refunded


# --------------------------------------------------------------------------
# Queries
# --------------------------------------------------------------------------
def get_payment(db: Session, payment_id: int) -> Payment:
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise NotFoundError("Payment not found")
    return payment


def payment_to_out(payment: Payment) -> PaymentAttemptOut:
    return PaymentAttemptOut.model_validate(payment)


def list_admin_payments(
    db: Session,
    params: PaginationParams,
    *,
    status: str | None = None,
    provider: str | None = None,
    q: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
) -> Page[PaymentAdminOut]:
    filters = []
    if status:
        try:
            filters.append(Payment.status == PaymentAttemptStatus(status))
        except ValueError as exc:
            raise AppError(f"Unknown payment status '{status}'") from exc
    if provider:
        filters.append(Payment.provider == provider)
    if q:
        needle = f"%{q.strip()}%"
        filters.append(Payment.provider_ref.ilike(needle) | Order.order_number.ilike(needle))
    if start is not None:
        filters.append(Payment.created_at >= start)
    if end is not None:
        filters.append(Payment.created_at < end)

    base = select(Payment).join(Order, Order.id == Payment.order_id).where(*filters)
    total = (
        db.scalar(
            select(func.count())
            .select_from(Payment)
            .join(Order, Order.id == Payment.order_id)
            .where(*filters)
        )
        or 0
    )

    sort_map = {
        "newest": Payment.created_at.desc(),
        "oldest": Payment.created_at.asc(),
        "amount_desc": Payment.amount.desc(),
        "amount_asc": Payment.amount.asc(),
    }
    order_by = sort_map.get(params.sort, sort_map["newest"])

    rows = db.scalars(
        base.options(selectinload(Payment.order))
        .order_by(order_by, Payment.id.desc())
        .offset(params.offset)
        .limit(params.page_size)
    ).unique().all()

    items = [
        PaymentAdminOut.model_validate(p).model_copy(
            update={"order_number": p.order.order_number if p.order else ""}
        )
        for p in rows
    ]
    pages = max((total + params.page_size - 1) // params.page_size, 1) if total else 1
    return Page[PaymentAdminOut](
        items=items, total=total, page=params.page, page_size=params.page_size, pages=pages
    )


def payment_admin_out(db: Session, payment: Payment) -> PaymentAdminOut:
    order = db.get(Order, payment.order_id)
    return PaymentAdminOut.model_validate(payment).model_copy(
        update={"order_number": order.order_number if order else ""}
    )


def attempts_for_order(db: Session, order_id: int) -> list[Payment]:
    return list(
        db.scalars(
            select(Payment)
            .where(Payment.order_id == order_id)
            .order_by(Payment.id.desc())
        ).all()
    )
