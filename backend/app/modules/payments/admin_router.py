"""Admin > Payments: audit the attempts, see what the gateway said, refund."""

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_staff
from app.core.exceptions import ConflictError
from app.core.pagination import Page, PaginationParams
from app.modules.orders.models import Order
from app.modules.payments import service as payments_service
from app.modules.payments.models import Payment, PaymentAttemptStatus
from app.modules.payments.schemas import (
    PaymentAdminOut,
    PaymentAttemptOut,
    PaymentDetailOut,
    RefundIn,
)
from app.modules.users.models import User

router = APIRouter(prefix="/admin", tags=["admin-payments"])

STATUSES = ", ".join(s.value for s in PaymentAttemptStatus)
PROVIDERS = "cod, zarinpal"
SORTS = "newest, oldest, amount_desc, amount_asc"


@router.get("/payments", response_model=Page[PaymentAdminOut])
def admin_payments(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: str = Query("newest", description=SORTS),
    status: str | None = Query(None, description=STATUSES),
    provider: str | None = Query(None, max_length=40, description=PROVIDERS),
    q: str | None = Query(None, max_length=120),
    start: datetime | None = None,
    end: datetime | None = None,
):
    """Every attempt, newest first, filterable by status/provider/date/search."""
    params = PaginationParams(page=page, page_size=page_size, sort=sort)
    return payments_service.list_admin_payments(
        db, params, status=status, provider=provider, q=q, start=start, end=end
    )


@router.get("/payments/{payment_id}", response_model=PaymentDetailOut)
def admin_payment_detail(
    payment_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    """One attempt plus every other attempt on the same order, raw response
    included — the "what did the gateway actually say" screen."""
    payment = payments_service.get_payment(db, payment_id)
    order = db.get(Order, payment.order_id)
    attempts = payments_service.attempts_for_order(db, payment.order_id)
    base = payments_service.payment_admin_out(db, payment)
    return PaymentDetailOut(
        **base.model_dump(),
        order_status=order.status.value if order else "",
        raw_response=payment.raw_response or {},
        attempts=[PaymentAttemptOut.model_validate(a) for a in attempts],
    )


@router.post("/payments/{payment_id}/refund", response_model=PaymentAdminOut)
def admin_refund(
    payment_id: int,
    payload: RefundIn,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    """Full or partial refund of one attempt.

    Lock order first, then the payment (the same order the callback takes), so
    a refund can never race a verification for the same money. ``manual`` skips
    the gateway call for money that moved outside it.
    """
    probe = payments_service.get_payment(db, payment_id)
    order = db.execute(
        select(Order).where(Order.id == probe.order_id).with_for_update()
    ).scalar_one()
    payment = db.execute(
        select(Payment).where(Payment.id == payment_id).with_for_update()
    ).scalar_one()

    if order.status not in ("cancelled", "delivered") and payload.amount is None:
        # A partial refund is fine on a live order (missing item, restocking
        # fee); a *full* refund would leave it "refunded but still shipping",
        # so cancel it first — the cancellation refunds automatically.
        raise ConflictError(
            "Cancel the order first to refund it in full, or enter a partial amount"
        )

    payments_service.refund_payment(
        db,
        payment,
        Decimal(str(payload.amount)) if payload.amount is not None else None,
        reason=payload.reason,
        manual=payload.manual,
    )
    db.commit()
    return payments_service.payment_admin_out(db, payment)
