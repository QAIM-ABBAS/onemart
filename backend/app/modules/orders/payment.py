"""Payment abstraction.

Order code only ever talks to `PaymentProvider`. Adding Stripe/PayPal later means
registering a new provider here — checkout and order services stay untouched.

Two shapes of provider live behind the same contract:

* **offline** (COD) — settles inside the order's own lifecycle: ``authorize``
  at checkout, ``capture`` on delivery, ``refund`` on cancellation;
* **online** (Zarinpal) — ``authorize`` only marks the order as awaiting money,
  then ``start_payment`` hands the customer to the gateway and
  ``verify_payment`` is called *server-side* on the way back. The redirect
  parameters are never trusted: the amount always comes from our database.

``_PaymentRegistry`` loads the gateway adapters lazily on first use so that
``orders.payment`` never imports the payments module at import time (which
would be a cycle — the adapter imports this interface).
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from app.core.exceptions import AppError
from app.modules.orders.models import Order, PaymentStatus


@dataclass
class PaymentResult:
    status: PaymentStatus
    reference: str | None = None
    message: str | None = None


@dataclass
class GatewayStart:
    """Where to send the customer after an attempt has been opened."""

    authority: str
    redirect_url: str
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class VerifyOutcome:
    """The gateway's own answer, obtained by a server-to-server call."""

    ok: bool
    code: str | int | None = None
    reference: str | None = None
    message: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class PaymentProvider(ABC):
    """Contract every payment gateway must implement."""

    code: str
    display_name: str
    supports_capture: bool = False
    # True when money moves through an external gateway, i.e. the order waits
    # on a callback and its stock is reserved rather than consumed.
    is_online: bool = False
    supports_refund: bool = True

    @abstractmethod
    def authorize(self, order: Order, amount: Decimal) -> PaymentResult:
        """Called inside the checkout transaction, before commit."""

    @abstractmethod
    def capture(self, order: Order, amount: Decimal) -> PaymentResult:
        """Called when the order is fulfilled (e.g. delivered)."""

    @abstractmethod
    def refund(self, order: Order, amount: Decimal, *, provider_ref: str | None = None,
               reason: str | None = None) -> PaymentResult:
        """Called when a paid order is cancelled or an admin refunds a payment."""

    def start_payment(
        self, order: Order, amount: Decimal, *, callback_url: str, description: str
    ) -> GatewayStart:
        """Open an attempt at the gateway. Online providers override this."""
        raise AppError(f"{self.display_name} cannot be started")

    def verify_payment(self, *, authority: str, amount: Decimal) -> VerifyOutcome:
        """Ask the gateway whether ``authority`` was really paid for ``amount``."""
        raise AppError(f"{self.display_name} cannot verify payments")


class CashOnDeliveryProvider(PaymentProvider):
    code = "cod"
    display_name = "Cash on Delivery"
    supports_capture = False
    is_online = False
    supports_refund = False  # nothing was ever charged: a refund is bookkeeping

    def authorize(self, order: Order, amount: Decimal) -> PaymentResult:
        return PaymentResult(
            status=PaymentStatus.PENDING,
            reference=f"COD-{order.order_number}",
            message="Pay in cash when your order arrives",
        )

    def capture(self, order: Order, amount: Decimal) -> PaymentResult:
        return PaymentResult(status=PaymentStatus.PAID, reference=f"COD-{order.order_number}")

    def refund(self, order: Order, amount: Decimal, *, provider_ref: str | None = None,
               reason: str | None = None) -> PaymentResult:
        return PaymentResult(status=PaymentStatus.REFUNDED, reference=f"COD-{order.order_number}")


class _PaymentRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, PaymentProvider] = {}
        self._loaded = False

    def register(self, provider: PaymentProvider) -> None:
        self._providers[provider.code] = provider

    def has(self, code: str) -> bool:
        self._ensure_loaded()
        return code in self._providers

    def _ensure_loaded(self) -> None:
        """Import the gateway adapters on first use (keeps this module free of
        imports from ``app.modules.payments``, which imports the ABC above)."""
        if self._loaded:
            return
        self._loaded = True
        from app.modules.payments import register_providers

        register_providers()

    def get(self, code: str) -> PaymentProvider:
        self._ensure_loaded()
        provider = self._providers.get(code)
        if provider is None:
            raise AppError(
                f"Payment method '{code}' is not available",
                details={"available": sorted(self._providers)},
            )
        return provider

    @property
    def codes(self) -> list[str]:
        self._ensure_loaded()
        return sorted(self._providers)


payment_registry = _PaymentRegistry()
payment_registry.register(CashOnDeliveryProvider())
