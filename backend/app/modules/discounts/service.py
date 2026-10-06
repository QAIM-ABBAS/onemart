"""Coupon lookup, validation and redemption.

Validation runs twice by design: once when the customer types the code (so they
get an immediate reason), and again inside the checkout transaction (so a cart
that changed in the meantime, or a code that expired, can never charge the
discounted total). The final guard is :func:`claim_usage`, an atomic conditional
UPDATE that only one of two racing customers can win.
"""

from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ConflictError, NotFoundError
from app.modules.cart.models import Cart
from app.modules.discounts.exceptions import CouponError
from app.modules.discounts.models import (
    Coupon,
    CouponRedemption,
    Discount,
    DiscountKind,
    DiscountScope,
)
from app.modules.discounts.pricing import (
    HUNDRED,
    ZERO,
    CouponSpec,
    Pricing,
    cart_subtotal,
    money,
    price_cart,
)

__all__ = [
    "active_coupon",
    "apply_coupon",
    "auto_discount_total",
    "cart_lines",
    "claim_usage",
    "clear_coupon",
    "normalize_code",
    "price_for_cart",
    "record_redemption",
    "spec_for",
    "validate_coupon",
]


def normalize_code(code: str) -> str:
    """'  welcome10 ' -> 'WELCOME10'."""
    return " ".join(code.split()).upper()


def cart_lines(cart: Cart) -> list[tuple[Decimal, int]]:
    return [(item.unit_price, item.quantity) for item in cart.items]


def spec_for(coupon: Coupon) -> CouponSpec:
    return CouponSpec(
        id=coupon.id,
        code=coupon.code,
        kind=coupon.kind.value,
        value=coupon.value,
        max_discount=coupon.max_discount,
    )


def _aware(value: datetime | None) -> datetime | None:
    """Treat naive datetimes from seeds/admin input as UTC."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _redemptions_by(db: Session, coupon: Coupon, user_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(CouponRedemption)
            .where(
                CouponRedemption.coupon_id == coupon.id,
                CouponRedemption.user_id == user_id,
            )
        )
        or 0
    )


def validate_coupon(db: Session, cart: Cart, coupon: Coupon) -> None:
    """Raise with a customer-facing reason if the coupon cannot be used here."""
    if not coupon.is_active:
        raise CouponError("This coupon is no longer active")

    now = datetime.now(UTC)
    starts_at, ends_at = _aware(coupon.starts_at), _aware(coupon.ends_at)
    if starts_at is not None and now < starts_at:
        raise CouponError("This coupon isn't active yet")
    if ends_at is not None and now >= ends_at:
        raise CouponError("This coupon has expired")

    if coupon.usage_limit is not None and coupon.used_count >= coupon.usage_limit:
        raise CouponError("This coupon has been fully redeemed")

    subtotal = cart_subtotal(cart_lines(cart))
    min_subtotal = money(coupon.min_subtotal or ZERO)
    if subtotal < min_subtotal:
        # Cart-driven: the basket shrank, so the cart simply drops the code and
        # the totals the customer sees stay truthful. Not a CouponError.
        gap = money(min_subtotal - subtotal)
        raise ConflictError(f"Add ₹{gap} more to use this coupon.")

    if coupon.per_user_limit is not None and cart.user_id is not None:
        used = _redemptions_by(db, coupon, cart.user_id)
        if used >= coupon.per_user_limit:
            raise CouponError("You've already used this coupon")


def apply_coupon(db: Session, cart: Cart, code: str) -> Coupon:
    coupon = db.scalar(select(Coupon).where(Coupon.code == normalize_code(code)))
    if coupon is None:
        raise NotFoundError("That coupon code doesn't exist")
    validate_coupon(db, cart, coupon)
    cart.coupon = coupon
    db.flush()
    return coupon


def active_coupon(db: Session, cart: Cart, *, strict: bool = False) -> Coupon | None:
    """The cart's coupon if it still applies — otherwise clear it and report None.

    Called on every cart read and mutation, so a coupon that stops qualifying
    (items removed, window closed, usage exhausted) disappears from the totals
    instead of quietly over- or under-charging.

    ``strict=True`` (checkout) re-raises :class:`CouponError`: if the coupon
    itself became unusable after the customer was shown its discount, checkout
    stops with 409 and the reason rather than charging the higher total.
    Cart-driven invalidation still just clears the code — the cart and the
    checkout summary both recompute from the same place, so what they showed
    remains what is charged.
    """
    coupon = cart.coupon
    if coupon is None:
        return None
    try:
        validate_coupon(db, cart, coupon)
    except CouponError:
        if strict:
            raise
        cart.coupon = None
        db.flush()
        return None
    except AppError:
        cart.coupon = None
        db.flush()
        return None
    return coupon


def clear_coupon(db: Session, cart: Cart) -> None:
    cart.coupon = None
    db.flush()


def _rule_amount(rule: Discount, base: Decimal) -> Decimal:
    """Rupees this rule takes off a group base of ``base``."""
    if rule.kind == DiscountKind.PERCENT:
        return money(min(base * rule.value / HUNDRED, base))
    return money(min(rule.value, base))


def auto_discount_total(db: Session, cart: Cart) -> Decimal:
    """The automatic (no-code) discount for this cart — the pricing engine's
    first layer, applied before any coupon.

    Rules, all evaluated against ``is_active`` rows inside their window:
      * product-scope rules claim a line before category-scope ones;
      * within the winning scope the single best rule wins (percent and fixed
        compared by the rupees they would actually take) — nothing stacks;
      * a ``fixed`` rule pays once per product/category group, not per line.
    """
    if not cart.items:
        return ZERO

    from app.modules.catalog.models import Product, ProductVariant

    now = datetime.now(UTC)
    variant_ids = {item.variant_id for item in cart.items}
    variant_product = dict(
        db.execute(
            select(ProductVariant.id, ProductVariant.product_id).where(
                ProductVariant.id.in_(variant_ids)
            )
        ).all()
    )
    product_ids = set(variant_product.values())
    if not product_ids:
        return ZERO
    product_category = dict(
        db.execute(
            select(Product.id, Product.category_id).where(Product.id.in_(product_ids))
        ).all()
    )

    category_ids = {
        product_category[pid]
        for pid in product_ids
        if product_category.get(pid) is not None
    }
    candidates = db.scalars(
        select(Discount).where(
            Discount.is_active.is_(True),
            or_(Discount.starts_at.is_(None), Discount.starts_at <= now),
            or_(Discount.ends_at.is_(None), Discount.ends_at > now),
            or_(
                and_(
                    Discount.scope == DiscountScope.PRODUCT,
                    Discount.product_id.in_(product_ids),
                ),
                and_(
                    Discount.scope == DiscountScope.CATEGORY,
                    Discount.category_id.in_(category_ids),
                ),
            ),
        )
    ).all()
    if not candidates:
        return ZERO

    by_product: dict[int, list[Discount]] = defaultdict(list)
    by_category: dict[int, list[Discount]] = defaultdict(list)
    for rule in candidates:
        if rule.scope == DiscountScope.PRODUCT and rule.product_id is not None:
            by_product[rule.product_id].append(rule)
        elif rule.category_id is not None:
            by_category[rule.category_id].append(rule)

    # One entry per cart line: (product_id, category_id, line base).
    lines: list[tuple[int, int | None, Decimal]] = []
    for item in cart.items:
        pid = variant_product.get(item.variant_id)
        if pid is None:
            continue
        lines.append(
            (pid, product_category.get(pid), money(item.unit_price) * item.quantity)
        )

    total = ZERO
    claimed: list[bool] = [False] * len(lines)

    # Product-scope groups claim their lines outright — product beats category.
    product_groups: dict[int, list[int]] = defaultdict(list)
    for index, (pid, _cid, _base) in enumerate(lines):
        if pid in by_product:
            product_groups[pid].append(index)
    for pid, indexes in product_groups.items():
        base = sum((lines[i][2] for i in indexes), ZERO)
        total += max(_rule_amount(rule, base) for rule in by_product[pid])
        for i in indexes:
            claimed[i] = True

    # What is left falls back to category-scope rules.
    category_groups: dict[int, list[int]] = defaultdict(list)
    for index, (_pid, cid, _base) in enumerate(lines):
        if not claimed[index] and cid is not None and cid in by_category:
            category_groups[cid].append(index)
    for cid, indexes in category_groups.items():
        base = sum((lines[i][2] for i in indexes), ZERO)
        total += max(_rule_amount(rule, base) for rule in by_category[cid])

    return money(min(total, cart_subtotal(cart_lines(cart))))


def price_for_cart(db: Session, cart: Cart) -> Pricing:
    """Price the cart with its automatic discounts and (still valid) coupon."""
    coupon = active_coupon(db, cart)
    auto = auto_discount_total(db, cart)
    return price_cart(
        cart_lines(cart),
        spec_for(coupon) if coupon is not None else None,
        auto_discount=auto,
    )


def claim_usage(db: Session, coupon: Coupon) -> None:
    """Take one redemption slot. Raises 409 if this was the last one and a
    concurrent request got there first — the row lock serialises the racers."""
    result = db.execute(
        update(Coupon)
        .where(
            Coupon.id == coupon.id,
            Coupon.is_active.is_(True),
            or_(Coupon.usage_limit.is_(None), Coupon.used_count < Coupon.usage_limit),
        )
        .values(used_count=Coupon.used_count + 1)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        db.expire(coupon)
        raise CouponError("This coupon has been fully redeemed")
    db.expire(coupon)


def record_redemption(
    db: Session, coupon: Coupon, *, user_id: int, order_id: int, discount: Decimal
) -> None:
    db.add(
        CouponRedemption(
            coupon_id=coupon.id,
            user_id=user_id,
            order_id=order_id,
            discount_amount=discount,
        )
    )
    db.flush()
