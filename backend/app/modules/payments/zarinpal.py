"""Zarinpal gateway adapter (v4 API), behind the shared ``PaymentProvider``.

Two modes, chosen by configuration:

* **live** — ``ZARINPAL_MERCHANT_ID`` is set: real HTTP calls to the sandbox
  (``ZARINPAL_SANDBOX=true``, the default) or production endpoint;
* **mock** — no merchant id: the same flow served locally. ``start_payment``
  returns a URL to our own StartPay page, the page records the customer's
  choice under the authority, and ``verify_payment`` reads that record. This
  gives dev and the Playwright suite a genuine redirect → callback → verify
  round trip with no network and no credentials.

Either way the caller supplies the amount — always read from our own database —
and the gateway answer comes back from a server-to-server call, never from the
redirect query string.
"""

from __future__ import annotations

import json
import uuid
from decimal import Decimal
from typing import Any

import httpx

from app.core.config import settings
from app.core.exceptions import AppError
from app.modules.discounts.pricing import money
from app.modules.orders.models import Order, PaymentStatus
from app.modules.orders.payment import GatewayStart, PaymentProvider, PaymentResult, VerifyOutcome

_MOCK_PREFIX = "zpmock:"
_MOCK_TTL_SECONDS = 60 * 30


def _mock_key(authority: str) -> str:
    return f"{_MOCK_PREFIX}{authority}"


def _mock_put(authority: str, record: dict[str, Any]) -> None:
    from app.core.redis import cache_set

    cache_set(_mock_key(authority), json.dumps(record), _MOCK_TTL_SECONDS)


def mock_record(authority: str) -> dict[str, Any] | None:
    """The local gateway's memory of an authority (None = unknown)."""
    from app.core.redis import cache_get

    raw = cache_get(_mock_key(authority))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def mock_decide(authority: str, result: str) -> dict[str, Any] | None:
    """Record the customer's decision on the local StartPay page.

    Only the first decision counts, so a reloaded or repeated link can never
    flip an already-decided authority — the same idempotency a real gateway
    gives us.
    """
    record = mock_record(authority)
    if record is None:
        return None
    if record.get("result") is None:
        record["result"] = "ok" if result == "ok" else "fail"
        _mock_put(authority, record)
    return record


class ZarinpalProvider(PaymentProvider):
    code = "zarinpal"
    display_name = "Online payment"
    supports_capture = False
    is_online = True
    supports_refund = True

    def __init__(self) -> None:
        merchant = settings.zarinpal_merchant_id.strip()
        self.merchant_id = merchant or "SANDBOX-MOCK-MERCHANT"
        self.mock = not merchant
        if settings.zarinpal_base_url.strip():
            self.base_url = settings.zarinpal_base_url.strip().rstrip("/")
        elif settings.zarinpal_sandbox:
            self.base_url = "https://sandbox.zarinpal.com"
        else:
            self.base_url = "https://payment.zarinpal.com"

    # -- helpers -----------------------------------------------------------
    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Server-to-server call. Raises AppError (a 4xx/5xx from the gateway
        is a failure to *reach* a verdict, not a failed payment)."""
        try:
            response = httpx.post(
                f"{self.base_url}{path}",
                json=payload,
                timeout=settings.zarinpal_timeout_seconds,
            )
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise AppError("The payment gateway is unreachable right now") from exc
        return data if isinstance(data, dict) else {}

    # -- PaymentProvider ---------------------------------------------------
    def authorize(self, order: Order, amount: Decimal) -> PaymentResult:
        """No gateway call here — checkout must stay inside its transaction.
        The attempt is opened by ``start_payment`` once the order is committed."""
        return PaymentResult(
            status=PaymentStatus.PENDING,
            message="Complete the payment to confirm your order",
        )

    def capture(self, order: Order, amount: Decimal) -> PaymentResult:
        # Online orders are captured the moment the callback verifies them.
        return PaymentResult(status=PaymentStatus.PAID)

    def start_payment(
        self, order: Order, amount: Decimal, *, callback_url: str, description: str
    ) -> GatewayStart:
        if self.mock:
            authority = f"MOCK{uuid.uuid4().hex[:24].upper()}"
            _mock_put(
                authority,
                {
                    "charged": str(money(amount)),
                    "currency": settings.payment_currency,
                    "callback_url": callback_url,
                    "order_number": order.order_number,
                    "description": description,
                    "result": None,
                },
            )
            return GatewayStart(
                authority=authority,
                redirect_url=f"{settings.api_public_url}/api/payments/mock/{authority}",
                raw={"mock": True, "amount": str(money(amount))},
            )

        data = self._post(
            "/pg/v4/payment/request.json",
            {
                "MerchantID": self.merchant_id,
                "Amount": int(amount),
                "Currency": settings.zarinpal_currency,
                "CallbackURL": callback_url,
                "Description": description,
            },
        )
        code = data.get("Code") or data.get("code")
        authority = data.get("Authority") or data.get("authority")
        if code not in (100, 101) or not authority:
            raise AppError(
                "The payment gateway declined to open this payment",
                details={"code": code},
            )
        return GatewayStart(
            authority=str(authority),
            redirect_url=f"{self.base_url}/pg/StartPay/{authority}",
            raw=data,
        )

    def verify_payment(self, *, authority: str, amount: Decimal) -> VerifyOutcome:
        if self.mock:
            record = mock_record(authority)
            if record is None:
                return VerifyOutcome(
                    ok=False,
                    code="unknown_authority",
                    message="This payment reference is unknown",
                    raw={"mock": True},
                )
            charged = money(record.get("charged", "0"))
            if charged != money(amount):
                # The gateway charged a different number than we are asking
                # about: never mark this paid.
                return VerifyOutcome(
                    ok=False,
                    code="amount_mismatch",
                    message="Amount does not match the gateway's record",
                    raw={"mock": True, "charged": str(charged), "verified": str(money(amount))},
                )
            if record.get("result") != "ok":
                return VerifyOutcome(
                    ok=False,
                    code="not_paid",
                    message="The payment was not completed",
                    raw={"mock": True, "result": record.get("result")},
                )
            return VerifyOutcome(
                ok=True,
                code=100,
                reference=f"MOCK{uuid.uuid4().hex[:12].upper()}",
                message="Verified by the gateway",
                raw={"mock": True, "charged": str(charged)},
            )

        data = self._post(
            "/pg/v4/payment/verify.json",
            {
                "MerchantID": self.merchant_id,
                "Amount": int(amount),
                "Currency": settings.zarinpal_currency,
                "Authority": authority,
            },
        )
        code = data.get("Code") if data.get("Code") is not None else data.get("code")
        ref = data.get("RefID") or data.get("ref_id")
        # 100 = verified, 101 = already verified earlier (idempotent replay).
        return VerifyOutcome(
            ok=code in (100, 101),
            code=code,
            reference=str(ref) if ref is not None else None,
            message=str(data.get("message") or data.get("Message") or "") or None,
            raw=data,
        )

    def refund(
        self,
        order: Order,
        amount: Decimal,
        *,
        provider_ref: str | None = None,
        reason: str | None = None,
    ) -> PaymentResult:
        if self.mock:
            return PaymentResult(
                status=PaymentStatus.REFUNDED,
                reference=provider_ref,
                message="Refunded (mock gateway)",
            )
        if not provider_ref:
            raise AppError("This payment has no gateway reference to refund")
        data = self._post(
            "/pg/v4/refund/request.json",
            {
                "MerchantID": self.merchant_id,
                "Amount": int(amount),
                "Currency": settings.zarinpal_currency,
                "Authority": provider_ref,
                "Description": reason or f"Refund for {order.order_number}",
            },
        )
        code = data.get("Code") if data.get("Code") is not None else data.get("code")
        if code not in (100, 101):
            raise AppError(
                "The gateway refused the refund",
                details={"code": code},
            )
        ref = data.get("RefID") or data.get("ref_id")
        return PaymentResult(
            status=PaymentStatus.REFUNDED,
            reference=str(ref) if ref is not None else provider_ref,
            message="Refund accepted by the gateway",
        )
