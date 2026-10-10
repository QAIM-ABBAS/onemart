"""Cart and order money math.

This module is the single source of truth for totals: ``serialize_cart`` and
``checkout`` both call :func:`price_cart`, so the total shown in the cart is
always the total that lands on the order.

Everything is ``Decimal``; each field is rounded exactly once with ROUND_HALF_UP,
and the fields are derived from the rounded values above them so the printed
arithmetic always adds up:

    total == (subtotal - flash_discount - auto_discount - discount) + delivery

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


@dataclass(frozen=True)
class DeliverySpec:
    """The delivery money rules for one quote.

    ``fee`` is what the chosen method costs before any waiver; ``free_over``
    is the goods amount at/above which delivery becomes free (``None`` =
    never free on its own — only a free_delivery coupon can waive it).

    Callers that don't pass a spec get :meth:`default`, i.e. the historic flat
    store-wide rule, so a cart without an address prices exactly as before.
    """

    fee: Decimal
    free_over: Decimal | None = FREE_DELIVERY_OVER

    @classmethod
    def default(cls) -> "DeliverySpec":
        return cls(fee=DELIVERY_FEE, free_over=FREE_DELIVERY_OVER)


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
    # When True the coupon's goods discount only touches the non-flash part of
    # the basket (flash-deal prices already beat the regular discount stack).
    exclude_flash_deals: bool = False


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
    # What flash-deal pricing took off the list prices (list minus deal, over
    # every flash line). Flash lines never receive auto-discounts too.
    flash_discount: Decimal = ZERO

    @property
    def payable(self) -> Decimal:
        """What the items cost after the flash, automatic and coupon
        discounts (delivery excluded)."""
        return self.subtotal - self.flash_discount - self.auto_discount - self.discount

    @property
    def total_discount(self) -> Decimal:
        """Everything taken off the list prices (flash + automatic + coupon)."""
        return self.flash_discount + self.auto_discount + self.discount

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
    delivery: DeliverySpec | None = None,
    flash_discount: Decimal | float | int | str = ZERO,
    flash_value: Decimal | float | int | str = ZERO,
) -> Pricing:
    """Price a cart: base prices -> flash -> automatic discount -> coupon -> delivery.

    ``lines`` carry the LIST prices; ``flash_discount`` is what the flash-deal
    prices took off them and ``flash_value`` is what the flash lines are worth
    after that cut (deal price × quantity, summed). Flash beats the automatic
    layer: the caller never puts a flash line forward for an admin rule, and
    the two amounts are capped so their sum can never exceed the subtotal.

    ``auto_discount`` is the sum the admin rules picked for this cart
    (:func:`app.modules.discounts.service.auto_discount_total`); it comes off
    the goods first and the coupon applies to what is left. A coupon with
    ``exclude_flash_deals`` computes its goods discount on
    ``goods - flash_value`` only — flash lines are simply not coupon material.
    A ``free_delivery`` coupon waives the delivery line instead of cutting
    goods, so that goods-level exclusion does not apply to it.

    Delivery is decided on the final goods amount: a ₹1050 basket with a
    ₹100 coupon pays on ₹950 and therefore does not qualify for free
    delivery. The coupon is only attached when it actually changes the bill
    (a code that saves nothing — e.g. free delivery on a cart that already
    qualifies — is not recorded as applied or redeemed).

    ``delivery`` is the zone/method quote (:class:`DeliverySpec`); without it
    the store-wide default rule applies, so every call site without an
    address keeps pricing exactly as it always has.
    """
    subtotal = cart_subtotal(lines)
    flash = money(max(ZERO, min(_as_decimal(flash_discount), subtotal)))
    auto = money(max(ZERO, min(_as_decimal(auto_discount), subtotal - flash)))

    goods = subtotal - flash - auto

    discount = ZERO
    coupon_value = ZERO
    coupon_id: int | None = None
    coupon_code: str | None = None
    waive_delivery = False
    if coupon is not None and subtotal > ZERO:
        if coupon.kind == FREE_DELIVERY:
            waive_delivery = True
        else:
            base = goods
            if coupon.exclude_flash_deals:
                base = goods - money(max(ZERO, min(_as_decimal(flash_value), goods)))
            discount = discount_amount(
                base,
                kind=coupon.kind,
                value=coupon.value,
                max_discount=coupon.max_discount,
            )
            if discount > ZERO:
                coupon_id = coupon.id
                coupon_code = coupon.code
                coupon_value = discount
        goods -= discount

    spec = delivery or DeliverySpec.default()
    if subtotal == ZERO or (spec.free_over is not None and goods >= spec.free_over):
        fee = ZERO
    else:
        fee = spec.fee

    if waive_delivery and fee > ZERO:
        coupon_id = coupon.id
        coupon_code = coupon.code
        coupon_value = fee
        fee = ZERO

    return Pricing(
        subtotal=money(subtotal),
        discount=money(discount),
        delivery=money(fee),
        total=money(goods + fee),
        coupon_id=coupon_id,
        coupon_code=coupon_code,
        auto_discount=auto,
        coupon_value=money(coupon_value),
        flash_discount=flash,
    )


def free_delivery_gap(
    subtotal_after_discount: Decimal | float, delivery: DeliverySpec | None = None
) -> Decimal:
    """How much more to spend for free delivery (0 when already there).

    A ``free_over`` of ``None`` means the zone never waives on amount — the
    gap is then reported as 0 rather than showing a target that can't exist.
    """
    spec = delivery or DeliverySpec.default()
    if spec.free_over is None:
        return ZERO
    payable = _as_decimal(subtotal_after_discount)
    if payable >= spec.free_over:
        return ZERO
    return money(spec.free_over - payable)
