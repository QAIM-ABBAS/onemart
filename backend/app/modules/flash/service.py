"""Flash-deal pricing, stock claims and releases.

The pricing hook (:func:`flash_cart`) answers "what do this cart's lines cost
under the live deals" — it is read-only and cheap, called on every cart read,
summary and checkout. The mutation hooks are deliberately separate and only
run inside a bigger transaction:

* :func:`claim_for_checkout` — a conditional UPDATE per deal item
  (``sold + qty <= limit``) that two customers racing for the last unit
  serialise on; the loser gets a clear 409 and nothing is written. It also
  enforces ``per_user_limit`` against the customer's non-cancelled history.
* :func:`release_for_order` — gives units back when an order is cancelled or
  times out, exactly once per order (the ``orders.flash_released`` flag is
  set under the order row lock, so cancel and sweeper can never both pay out).

Deal stock never touches ``inventory``: it is a second, promotional counter
on top of real stock, and losing a deal race must not lose the actual item.
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError
from app.core.redis import cache_delete_prefix, cache_get, cache_set
from app.modules.discounts.pricing import HUNDRED, ZERO, money
from app.modules.flash.models import FlashDeal, FlashDealItem
from app.modules.orders.models import Order, OrderItem, OrderStatus
from app.modules.users.models import User

__all__ = [
    "FlashCart",
    "FlashLine",
    "claim_for_checkout",
    "flash_cart",
    "invalidate_flash_cache",
    "release_for_order",
]

_ACTIVE_CACHE_KEY = "flash:active:payload:v1"
_ACTIVE_CACHE_TTL = 30


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def deal_is_live(deal: FlashDeal, now: datetime) -> bool:
    if not deal.is_active:
        return False
    starts_at, ends_at = _aware(deal.starts_at), _aware(deal.ends_at)
    if starts_at is not None and now < starts_at:
        return False
    if ends_at is not None and now >= ends_at:
        return False
    return True


def deal_unit_price(item: FlashDealItem, list_price: Decimal) -> Decimal:
    """The unit price this deal item gives: absolute price, or percent off."""
    if item.deal_price is not None:
        return money(item.deal_price)
    percent = item.deal_percent or ZERO
    return money(list_price * (HUNDRED - percent) / HUNDRED)


@dataclass(frozen=True)
class FlashLine:
    """One cart line priced by a live deal."""

    item: FlashDealItem
    unit_price: Decimal  # deal unit price
    list_price: Decimal  # the cart line's own unit price (engine's input)


@dataclass(frozen=True)
class FlashCart:
    """The flash view of a cart, computed once per pricing pass."""

    lines: dict[int, FlashLine]  # variant_id -> line
    discount: Decimal  # list minus deal, over every flash line
    value: Decimal  # what the flash lines are worth after the cut
    variant_ids: frozenset[int]

    @property
    def empty(self) -> bool:
        return not self.lines


NO_FLASH = FlashCart(lines={}, discount=ZERO, value=ZERO, variant_ids=frozenset())


def flash_cart(
    db: Session, cart, *, now: datetime | None = None
) -> FlashCart:
    """The live-deal prices for this cart's variants (read-only).

    A variant in several live deals is priced by the best (lowest) unit price
    with stock left. Deals whose stock is exhausted simply don't count, so the
    price silently falls back to the regular stack — the spec'd behaviour.
    """
    if not cart.items:
        return NO_FLASH

    now = now or datetime.now(UTC)
    list_prices = {item.variant_id: money(item.unit_price) for item in cart.items}
    variant_ids = set(list_prices)

    rows = db.execute(
        select(FlashDealItem, FlashDeal)
        .join(FlashDeal, FlashDeal.id == FlashDealItem.deal_id)
        .where(
            FlashDealItem.variant_id.in_(variant_ids),
            FlashDeal.is_active.is_(True),
            or_(
                FlashDeal.starts_at.is_(None),
                FlashDeal.starts_at <= now,
            ),
            or_(FlashDeal.ends_at.is_(None), FlashDeal.ends_at > now),
            FlashDealItem.deal_stock_sold < FlashDealItem.deal_stock_limit,
        )
    ).all()

    best: dict[int, FlashLine] = {}
    for item, _deal in rows:
        list_price = list_prices[item.variant_id]
        unit = deal_unit_price(item, list_price)
        if unit >= list_price:
            continue  # not actually a deal at this list price — ignore
        current = best.get(item.variant_id)
        if current is None or unit < current.unit_price:
            best[item.variant_id] = FlashLine(
                item=item, unit_price=unit, list_price=list_price
            )

    if not best:
        return NO_FLASH

    discount = ZERO
    value = ZERO
    for variant_id, line in best.items():
        qty = next(i.quantity for i in cart.items if i.variant_id == variant_id)
        discount += (line.list_price - line.unit_price) * qty
        value += line.unit_price * qty
    return FlashCart(
        lines=best,
        discount=money(discount),
        value=money(value),
        variant_ids=frozenset(best),
    )


def _owned_qty(db: Session, item_id: int, user_id: int) -> int:
    """How many of this deal item the customer already holds in live orders."""
    return int(
        db.scalar(
            select(func.coalesce(func.sum(OrderItem.quantity), 0))
            .join(Order, Order.id == OrderItem.order_id)
            .where(
                OrderItem.flash_deal_item_id == item_id,
                Order.user_id == user_id,
                Order.status != OrderStatus.CANCELLED,
            )
        )
        or 0
    )


def claim_for_checkout(db: Session, user: User, cart, flash: FlashCart) -> None:
    """Take deal stock for this checkout — inside the order transaction.

    Raises 409 when the deal's last units were grabbed by a concurrent
    checkout, or when the customer is over their per-user limit. The caller's
    transaction rolls back, so nothing half-written survives.
    """
    if flash.empty:
        return

    quantities: dict[int, int] = {}
    for item in cart.items:
        if item.variant_id in flash.lines:
            deal_item_id = flash.lines[item.variant_id].item.id
            quantities[deal_item_id] = quantities.get(deal_item_id, 0) + item.quantity

    # Lock order: sorted by id, so two checkouts touching the same deal items
    # always serialise in the same direction (no deadlock against a sibling
    # checkout that also holds inventory locks).
    for deal_item_id in sorted(quantities):
        qty = quantities[deal_item_id]
        row = db.execute(
            select(FlashDealItem)
            .where(FlashDealItem.id == deal_item_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one()

        if row.per_user_limit is not None and user.id is not None:
            owned = _owned_qty(db, row.id, user.id)
            if owned + qty > row.per_user_limit:
                raise ConflictError(
                    f"You can buy at most {row.per_user_limit} of this flash deal"
                )

        # Atomic conditional UPDATE: of two customers racing for the last unit
        # exactly one wins; the loser gets a clear "sold out" and rolls back.
        result = db.execute(
            update(FlashDealItem)
            .where(
                FlashDealItem.id == row.id,
                FlashDealItem.deal_stock_sold + qty <= FlashDealItem.deal_stock_limit,
            )
            .values(deal_stock_sold=FlashDealItem.deal_stock_sold + qty)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount == 0:
            raise ConflictError(
                "A flash deal in your cart just sold out — "
                "the price has fallen back to the regular one"
            )

    invalidate_flash_cache()


def release_for_order(db: Session, order: Order) -> int:
    """Give deal units back for an order that will not happen.

    Called on cancellation and on payment-timeout expiry — **under the order
    row lock** (both the cancel path and the sweeper take it first). The
    ``orders.flash_released`` flag makes the whole release exactly-once: the
    second path to arrive sees it set and does nothing, so a cancel racing
    the sweeper can never give back units twice. The decrement itself is
    also floored at zero as a belt-and-braces guard.

    Returns the number of deal rows released (0 when already done).
    """
    if order.flash_released:
        return 0

    rows = db.execute(
        select(OrderItem.flash_deal_item_id, OrderItem.quantity).where(
            OrderItem.order_id == order.id,
            OrderItem.flash_deal_item_id.is_not(None),
        )
    ).all()
    for deal_item_id, qty in rows:
        db.execute(
            update(FlashDealItem)
            .where(FlashDealItem.id == deal_item_id)
            .values(
                deal_stock_sold=func.greatest(
                    FlashDealItem.deal_stock_sold - qty, 0
                )
            )
            .execution_options(synchronize_session=False)
        )
    order.flash_released = True
    if rows:
        invalidate_flash_cache()
    return len(rows)


def invalidate_flash_cache() -> None:
    cache_delete_prefix("flash:active")


def active_payload(db: Session, *, user_id: int | None = None) -> list[dict]:
    """JSON-ready deals for the storefront strip and PDP badges.

    Only live deals with stock left and at least one buyable item come back
    — an empty list is the "hide the strip" signal. The shared part (deal
    window, item prices, claimed counters) is cached for 30s; the per-user
    remaining is computed per request on top of it.
    """
    now = datetime.now(UTC)
    raw = cache_get(_ACTIVE_CACHE_KEY)
    if raw is not None:
        deals: list[dict] = json.loads(raw)
    else:
        deals = _build_payload(db, now)
        cache_set(_ACTIVE_CACHE_KEY, json.dumps(deals), _ACTIVE_CACHE_TTL)

    if user_id is None:
        return deals
    return _with_user_remaining(db, deals, user_id)


def _build_payload(db: Session, now: datetime) -> list[dict]:
    from app.modules.catalog.models import Product, ProductVariant

    rows = db.execute(
        select(FlashDealItem, FlashDeal, ProductVariant, Product)
        .join(FlashDeal, FlashDeal.id == FlashDealItem.deal_id)
        .join(ProductVariant, ProductVariant.id == FlashDealItem.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(
            FlashDeal.is_active.is_(True),
            or_(FlashDeal.starts_at.is_(None), FlashDeal.starts_at <= now),
            or_(FlashDeal.ends_at.is_(None), FlashDeal.ends_at > now),
            FlashDealItem.deal_stock_sold < FlashDealItem.deal_stock_limit,
            Product.is_active.is_(True),
            ProductVariant.is_active.is_(True),
        )
        .order_by(FlashDeal.id, FlashDealItem.id)
    ).all()

    deals: dict[int, dict] = {}
    for item, deal, variant, product in rows:
        list_price = money(variant.price)
        unit = deal_unit_price(item, list_price)
        if unit >= list_price:
            continue
        remaining = item.deal_stock_limit - item.deal_stock_sold
        bucket = deals.get(deal.id)
        if bucket is None:
            bucket = {
                "id": deal.id,
                "name": deal.name,
                "starts_at": _aware(deal.starts_at).isoformat()
                if deal.starts_at
                else None,
                "ends_at": _aware(deal.ends_at).isoformat() if deal.ends_at else None,
                "items": [],
            }
            deals[deal.id] = bucket
        bucket["items"].append(
            {
                "id": item.id,
                "variant_id": item.variant_id,
                "product_id": product.id,
                "product_name": product.name,
                "product_slug": product.slug,
                "image_url": product.images[0].url if product.images else None,
                "variant_name": variant.name,
                "list_price": str(list_price),
                "deal_price": str(unit),
                "percent_off": str(
                    money((list_price - unit) / list_price * HUNDRED)
                ),
                "stock_limit": item.deal_stock_limit,
                "stock_sold": item.deal_stock_sold,
                "remaining": remaining,
                # HUNDRED first: int / int would be a float and float *
                # Decimal raises.
                "claimed_percent": str(
                    money(HUNDRED * item.deal_stock_sold / item.deal_stock_limit)
                ),
                "per_user_limit": item.per_user_limit,
            }
        )

    # A deal with nothing buyable left disappears entirely.
    return [d for d in deals.values() if d["items"]]


def _with_user_remaining(db: Session, deals: list[dict], user_id: int) -> list[dict]:
    result: list[dict] = []
    for deal in deals:
        items = []
        for item in deal["items"]:
            entry = dict(item)
            limit = item["per_user_limit"]
            if limit is not None:
                owned = _owned_qty(db, int(item["id"]), user_id)
                entry["per_user_remaining"] = max(int(limit) - owned, 0)
            items.append(entry)
        result.append({**deal, "items": items})
    return result
