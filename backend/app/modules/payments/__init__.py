"""Payments module: gateway adapters, attempts, callbacks, refunds.

``register_providers`` is called lazily by the payment registry the first time
a payment method is looked up (see ``app.modules.orders.payment``) — importing
it at module scope would cycle back through the adapter's interface import.
"""


def register_providers() -> None:
    from app.modules.orders.payment import payment_registry
    from app.modules.payments.zarinpal import ZarinpalProvider

    if not payment_registry.has(ZarinpalProvider.code):
        payment_registry.register(ZarinpalProvider())
