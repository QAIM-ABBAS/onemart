"""Customer-facing payment endpoints.

Everything here is deliberately boring for the caller and strict inside:

* ``POST /orders/{id}/payments`` opens an attempt and returns where to go;
* ``GET /payments/callback`` is where the *gateway* sends the browser — public,
  because the customer has no Authorization header after a redirect, and safe to
  be public because the verdict comes from a server-to-server verification;
* callback and webhook funnel into :func:`payments.service.handle_callback`,
  which is idempotent and amount-safe.

Concrete paths are declared before ``/payments/{payment_id}`` so a return URL
can never be swallowed by the parameterised route.
"""

from html import escape
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.exceptions import AppError, NotFoundError
from app.modules.orders import service as orders_service
from app.modules.orders.models import Order
from app.modules.payments import service as payments_service
from app.modules.payments.models import Payment
from app.modules.payments.schemas import PaymentInitiateOut, PaymentStatusOut
from app.modules.payments.zarinpal import mock_decide, mock_record
from app.modules.users.models import User, UserRole

router = APIRouter(tags=["payments"])


class WebhookIn(BaseModel):
    payment_id: int
    authority: str | None = Field(default=None, max_length=128)
    status: str | None = Field(default=None, max_length=16)


def _validated_origin(value: str | None) -> str | None:
    """An origin the customer may be sent back to — or ``None``.

    Only the configured SPA origins qualify: the return redirect must never
    become an open redirect just because a header (or a stored row) says so.
    """
    if not value or value.strip() in ("", "null"):
        return None
    origin = value.strip().rstrip("/")
    allowed = {o.rstrip("/") for o in settings.cors_origin_list}
    allowed.add(settings.public_base_url.rstrip("/"))
    return origin if origin in allowed else None


def _request_origin(request: Request) -> str | None:
    """Where the customer's browser is right now (the SPA that opened us)."""
    direct = _validated_origin(request.headers.get("origin"))
    if direct:
        return direct
    referer = request.headers.get("referer")
    if referer:
        parts = urlparse(referer)
        if parts.scheme and parts.netloc:
            return _validated_origin(f"{parts.scheme}://{parts.netloc}")
    return None


def _stored_origin(db: Session, payment_id: int) -> str | None:
    """The origin recorded when the attempt was opened (re-validated)."""
    payment = db.get(Payment, payment_id)
    if payment is None:
        return None
    return _validated_origin((payment.raw_response or {}).get("return_origin"))


def _result_url(payment_id: int, status: str, origin: str | None = None) -> str:
    """Where the customer lands after the gateway — never a blank page.

    ``origin`` is the validated host they started from, so bouncing through the
    gateway doesn't log them out of a dev server on a different loopback name;
    anything unrecognised falls back to the configured public base URL.
    """
    base = origin or settings.public_base_url
    return f"{base}/payment/result?payment_id={payment_id}&status={status}"


@router.post("/orders/{order_id}/payments", response_model=PaymentInitiateOut)
def initiate_payment(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Open a (new) payment attempt for an order that is still awaiting money.

    Called after checkout for an online order, and by the order page's
    "Retry payment" button after a failure.
    """
    order = orders_service.get_customer_order(db, user, order_id)
    return payments_service.initiate_attempt(
        db, order, return_origin=_request_origin(request)
    )


def _complete(db: Session, payment_id: int, authority: str | None, hint: str | None):
    origin = _stored_origin(db, payment_id)
    try:
        outcome = payments_service.handle_callback(
            db, payment_id=payment_id, authority=authority, status_hint=hint
        )
    except AppError:
        # The customer must still land somewhere sensible with a reason.
        return _result_url(payment_id, "failed", origin), None
    return _result_url(payment_id, outcome.status, origin), outcome


@router.get("/payments/callback")
def payment_callback(
    payment_id: int,
    Authority: str | None = None,  # noqa: N803 - the gateway's own parameter name
    Status: str | None = None,  # noqa: N803
    db: Session = Depends(get_db),
):
    """Gateway return URL: verify server-side, then hand back to the SPA."""
    url, _ = _complete(db, payment_id, Authority, Status)
    return RedirectResponse(url, status_code=302)


@router.post("/payments/webhook")
def payment_webhook(payload: WebhookIn, db: Session = Depends(get_db)):
    """Server-to-server twin of the callback (same idempotent service).

    A real gateway posts here even when the customer closes the tab; Zarinpal
    has no webhook, so this exists for parity and for the mock.
    """
    _, outcome = _complete(db, payload.payment_id, payload.authority, payload.status)
    if outcome is None:
        return {"ok": False, "status": "failed"}
    return {"ok": True, **outcome.model_dump(mode="json")}


# --- Local StartPay page (mock mode: no ZARINPAL_MERCHANT_ID) ---------------
_MOCK_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OneMart — mock payment gateway</title>
<style>
 body {{ font-family: Inter, system-ui, sans-serif; background:#FAF8F4; color:#12261C;
        display:grid; place-items:center; min-height:100vh; margin:0; }}
 .card {{ background:#fff; border:1px solid #E4E0D8; border-radius:10px; padding:28px;
          width:min(420px, 92vw); box-shadow:0 8px 24px rgba(18,38,28,.08); }}
 h1 {{ font-size:1.05rem; margin:0 0 4px; }}
 p {{ color:#5C6B62; font-size:.9rem; margin:0 0 18px; }}
 .amount {{ font-size:1.6rem; font-weight:700; color:#1F6B3A; margin:0 0 2px; }}
 .ref {{ font-family:ui-monospace, monospace; font-size:.75rem; color:#8A9691; word-break:break-all; }}
 .actions {{ display:flex; gap:10px; margin-top:22px; }}
 a.btn {{ flex:1; text-align:center; padding:11px 14px; border-radius:8px; font-weight:600;
          font-size:.9rem; text-decoration:none; }}
 .ok {{ background:#1F6B3A; color:#fff; }}
 .no {{ background:#fff; color:#C62F2F; border:1px solid #E4E0D8; }}
 small {{ display:block; margin-top:16px; color:#8A9691; font-size:.72rem; }}
</style></head><body>
<div class="card">
  <h1>OneMart · mock gateway</h1>
  <p>{description}</p>
  <div class="amount">{amount} {currency}</div>
  <div class="ref">{authority}</div>
  <div class="actions">
    <a class="btn ok" href="?result=ok">Complete payment</a>
    <a class="btn no" href="?result=fail">Simulate failure</a>
  </div>
  <small>Sandbox stand-in for Zarinpal (no ZARINPAL_MERCHANT_ID configured).</small>
</div></body></html>"""


@router.get("/payments/mock/{authority}", response_class=HTMLResponse)
def mock_startpay(authority: str, result: str | None = None):
    """Stand-in for the gateway's hosted page: pick an outcome, come back."""
    if result in ("ok", "fail"):
        record = mock_decide(authority, result)
        if record is None:
            raise NotFoundError("Unknown payment reference")
        callback = record["callback_url"]
        separator = "&" if "?" in callback else "?"
        status = "OK" if record["result"] == "ok" else "NOK"
        return RedirectResponse(
            f"{callback}{separator}Authority={quote(authority, safe='')}&Status={status}",
            status_code=302,
        )

    record = mock_record(authority)
    if record is None:
        raise NotFoundError("Unknown payment reference")
    return HTMLResponse(
        _MOCK_PAGE.format(
            description=escape(str(record.get("description") or "Complete your payment")),
            amount=escape(str(record.get("charged", ""))),
            currency=escape(str(record.get("currency", ""))),
            authority=escape(authority),
        )
    )


@router.get("/payments/{payment_id}", response_model=PaymentStatusOut)
def payment_status(
    payment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    payment = payments_service.get_payment(db, payment_id)
    order = db.scalar(select(Order).where(Order.id == payment.order_id))
    if order is None or (order.user_id != user.id and user.role == UserRole.CUSTOMER):
        raise NotFoundError("Payment not found")
    return payments_service.status_out(db, payment, order)
