"""Cart and order money math.

This module is the single source of truth for totals: ``serialize_cart`` and
``checkout`` both call :func:`price_cart`, so the total shown in the cart is
always the total that lands on the order.

Everything is ``Decimal``; each field is rounded exactly once with ROUND_HALF_UP,
and the fields are derived from the rounded values above them so the printed
arithmetic always adds up:

    total == (subtotal - discount) + delivery

No imports from other app modules — the engine is pure and unit-testable.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

CENTS = Decimal("0.01")
ZERO = Decimal("0.00")
HUNDRED = Decimal("100")

DELIVERY_FEE = Decimal("40.00")
FREE_DELIVERY_OVER = Decimal("999.00")

PERCENT = "percent"
FIXED = "fixed"


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

    @property
    def payable(self) -> Decimal:
        """What the items cost after the discount (delivery excluded)."""
        return self.subtotal - self.discount

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
) -> Pricing:
    """Price a cart, optionally with a coupon.

    Delivery is decided on the *discounted* amount: a ₹1050 basket with a ₹100
    coupon pays on ₹950 and therefore does not qualify for free delivery.
    """
    subtotal = cart_subtotal(lines)

    discount = ZERO
    coupon_id: int | None = None
    coupon_code: str | None = None
    if coupon is not None and subtotal > ZERO:
        discount = discount_amount(
            subtotal,
            kind=coupon.kind,
            value=coupon.value,
            max_discount=coupon.max_discount,
        )
        if discount > ZERO:
            coupon_id = coupon.id
            coupon_code = coupon.code

    payable = subtotal - discount
    if subtotal == ZERO or payable >= FREE_DELIVERY_OVER:
        delivery = ZERO
    else:
        delivery = DELIVERY_FEE

    return Pricing(
        subtotal=money(subtotal),
        discount=money(discount),
        delivery=money(delivery),
        total=money(payable + delivery),
        coupon_id=coupon_id,
        coupon_code=coupon_code,
    )


def free_delivery_gap(subtotal_after_discount: Decimal | float) -> Decimal:
    """How much more to spend for free delivery (0 when already there)."""
    payable = _as_decimal(subtotal_after_discount)
    if payable >= FREE_DELIVERY_OVER:
        return ZERO
    return money(FREE_DELIVERY_OVER - payable)


def as_sequence(lines: Iterable[tuple[Decimal | float, int]]) -> Sequence[tuple[Decimal, int]]:
    return [(_as_decimal(price), int(quantity)) for price, quantity in lines]
