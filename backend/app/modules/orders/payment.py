"""Payment abstraction.

Order code only ever talks to `PaymentProvider`. Adding Stripe/PayPal later means
registering a new provider here — checkout and order services stay untouched.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal

from app.core.exceptions import AppError
from app.modules.orders.models import Order, PaymentStatus


@dataclass
class PaymentResult:
    status: PaymentStatus
    reference: str | None = None
    message: str | None = None


class PaymentProvider(ABC):
    """Contract every payment gateway must implement."""

    code: str
    display_name: str
    supports_capture: bool = False

    @abstractmethod
    def authorize(self, order: Order, amount: Decimal) -> PaymentResult:
        """Called inside the checkout transaction, before commit."""

    @abstractmethod
    def capture(self, order: Order, amount: Decimal) -> PaymentResult:
        """Called when the order is fulfilled (e.g. delivered)."""

    @abstractmethod
    def refund(self, order: Order, amount: Decimal) -> PaymentResult:
        """Called when a paid order is cancelled."""


class CashOnDeliveryProvider(PaymentProvider):
    code = "cod"
    display_name = "Cash on Delivery"
    supports_capture = False

    def authorize(self, order: Order, amount: Decimal) -> PaymentResult:
        return PaymentResult(
            status=PaymentStatus.PENDING,
            reference=f"COD-{order.order_number}",
            message="Pay in cash when your order arrives",
        )

    def capture(self, order: Order, amount: Decimal) -> PaymentResult:
        return PaymentResult(status=PaymentStatus.PAID, reference=f"COD-{order.order_number}")

    def refund(self, order: Order, amount: Decimal) -> PaymentResult:
        return PaymentResult(status=PaymentStatus.REFUNDED, reference=f"COD-{order.order_number}")


class _PaymentRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, PaymentProvider] = {}

    def register(self, provider: PaymentProvider) -> None:
        self._providers[provider.code] = provider

    def get(self, code: str) -> PaymentProvider:
        provider = self._providers.get(code)
        if provider is None:
            raise AppError(
                f"Payment method '{code}' is not available",
                details={"available": sorted(self._providers)},
            )
        return provider

    @property
    def codes(self) -> list[str]:
        return sorted(self._providers)


payment_registry = _PaymentRegistry()
payment_registry.register(CashOnDeliveryProvider())
