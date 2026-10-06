"""Cart and order money math.

This module is the single source of truth for totals: ``serialize_cart`` and
``checkout`` both call :func:`price_cart`, so the total shown in the cart is
always the total that lands on the order.

Everything is ``Decimal``; each field is rounded exactly once with ROUND_HALF_UP,
and the fields are derived from the rounded values above them so the printed
arithmetic always adds up:

    total == (subtotal - auto_discount - discount) + delivery

No imports from other app modules — the engine is pure and unit-testable.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

CENTS = Decimal("0.01")
ZERO = Decimal("0.00")
HUNDRED = Decimal("100")

DELIVERY_FEE = Decimal("40.00")
FREE_DELIVERY_OVER = Decimal("999.00")

PERCENT = "percent"
FIXED = "fixed"
FREE_DELIVERY = "free_delivery"


def money(value: Decimal | float | int | str) -> Decimal:
    """Round to 2 decimal places, half-up (the way a receipt does)."""
    return Decimal(str(value)).quantize(CENTS, rounding=ROUND_HALF_UP)


def _as_decimal(value: Decimal | float | int | str) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


@dataclass(frozen=True)
class CouponSpec:
    """The engine's view of a coupon — keeps :mod:`.pricing` free of ORM imports."""

    id: int
    code: str
    kind: str
    value: Decimal | float | int | str
    max_discount: Decimal | float | int | str | None = None


@dataclass(frozen=True)
class Pricing:
    subtotal: Decimal
    discount: Decimal
    delivery: Decimal
    total: Decimal
    coupon_id: int | None = None
    coupon_code: str | None = None
    # Automatic (non-coupon) line discounts chosen by the admin rules; the
    # coupon then applies to what is left of the goods.
    auto_discount: Decimal = ZERO
    # What the coupon was worth: the goods discount, or the waived delivery for
    # a free_delivery coupon (which leaves ``discount`` at zero).
    coupon_value: Decimal = ZERO

    @property
    def payable(self) -> Decimal:
        """What the items cost after the automatic and coupon discounts
        (delivery excluded)."""
        return self.subtotal - self.auto_discount - self.discount

    @property
    def total_discount(self) -> Decimal:
        """Everything taken off the list prices (automatic + coupon)."""
        return self.auto_discount + self.discount

    @property
    def has_coupon(self) -> bool:
        return self.coupon_id is not None


def cart_subtotal(lines: Iterable[tuple[Decimal | float, int]]) -> Decimal:
    """Sum of unit_price × quantity over the cart."""
    subtotal = ZERO
    for unit_price, quantity in lines:
        subtotal += _as_decimal(unit_price) * quantity
    return money(subtotal)


def discount_amount(
    subtotal: Decimal,
    *,
    kind: str,
    value: Decimal | float | int | str,
    max_discount: Decimal | float | int | str | None = None,
) -> Decimal:
    """Discount for a coupon applied to ``subtotal``.

    Capped three ways so the payable amount can never go negative:
    by ``max_discount``, by the subtotal itself, and at zero.
    """
    raw = _as_decimal(subtotal)
    if kind == PERCENT:
        raw = raw * _as_decimal(value) / HUNDRED
    elif kind == FIXED:
        raw = _as_decimal(value)
    else:  # unknown kind: discount nothing rather than silently over-charging
        return ZERO

    if max_discount is not None:
        raw = min(raw, _as_decimal(max_discount))
    raw = min(raw, _as_decimal(subtotal))
    return money(max(raw, ZERO))


def price_cart(
    lines: Iterable[tuple[Decimal | float, int]],
    coupon: CouponSpec | None = None,
    *,
    auto_discount: Decimal | float | int | str = ZERO,
) -> Pricing:
    """Price a cart: base prices -> automatic discount -> coupon -> delivery.

    ``auto_discount`` is the sum the admin rules picked for this cart
    (:func:`app.modules.discounts.service.auto_discount_total`); it comes off
    the goods first and the coupon applies to what is left. It is floored at
    zero and capped at the subtotal, so a corrupt rule value can never inflate
    the bill the way a negative value would otherwise. Delivery is decided
    on that final amount: a ₹1050 basket with a ₹100 coupon pays on ₹950 and
    therefore does not qualify for free delivery.

    A ``free_delivery`` coupon waives the delivery line instead of cutting the
    goods; ``coupon_value`` reports what the coupon was worth either way. The
    coupon is only attached when it actually changes the bill (a code that
    saves nothing — e.g. free delivery on a cart that already qualifies — is
    not recorded as applied or redeemed).
    """
    subtotal = cart_subtotal(lines)
    auto = money(max(ZERO, min(_as_decimal(auto_discount), subtotal)))

    goods = subtotal - auto

    discount = ZERO
    coupon_value = ZERO
    coupon_id: int | None = None
    coupon_code: str | None = None
    waive_delivery = False
    if coupon is not None and subtotal > ZERO:
        if coupon.kind == FREE_DELIVERY:
            waive_delivery = True
        else:
            discount = discount_amount(
                goods,
                kind=coupon.kind,
                value=coupon.value,
                max_discount=coupon.max_discount,
            )
            if discount > ZERO:
                coupon_id = coupon.id
                coupon_code = coupon.code
                coupon_value = discount
        goods -= discount

    if subtotal == ZERO or goods >= FREE_DELIVERY_OVER:
        delivery = ZERO
    else:
        delivery = DELIVERY_FEE

    if waive_delivery and delivery > ZERO:
        coupon_id = coupon.id
        coupon_code = coupon.code
        coupon_value = delivery
        delivery = ZERO

    return Pricing(
        subtotal=money(subtotal),
        discount=money(discount),
        delivery=money(delivery),
        total=money(goods + delivery),
        coupon_id=coupon_id,
        coupon_code=coupon_code,
        auto_discount=auto,
        coupon_value=money(coupon_value),
    )


def free_delivery_gap(subtotal_after_discount: Decimal | float) -> Decimal:
    """How much more to spend for free delivery (0 when already there)."""
    payable = _as_decimal(subtotal_after_discount)
    if payable >= FREE_DELIVERY_OVER:
        return ZERO
    return money(FREE_DELIVERY_OVER - payable)
