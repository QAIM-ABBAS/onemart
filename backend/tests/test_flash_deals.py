"""Flash deals: engine layers, cart/checkout integration, races and admin.

Three layers, because each can break on its own:
  * pure engine maths — flash vs automatic vs coupon (incl. the
    ``exclude_flash_deals`` exclusion) with no HTTP and no DB;
  * the HTTP contract — cart display, silent fallback when the deal is
    exhausted, the checkout claim, release on cancel/sweeper, the public
    strip payload and the admin CRUD;
  * the race — two customers, one remaining deal unit: exactly one wins.
"""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from starlette.testclient import TestClient

from tests.conftest import PASSWORD, login

ADDRESS = {
    "full_name": "Casey Customer",
    "phone": "+91 98765 43210",
    "line1": "12, Test Street",
    "city": "Bengaluru",
    "state": "Karnataka",
    "postal_code": "560001",
    "country": "IN",
}


def _deal(db, *, name="Flash Friday", hours=6, active=True, starts_in=None, ends_in=None):
    from app.modules.flash.models import FlashDeal
    from app.modules.flash.service import invalidate_flash_cache

    now = datetime.now(UTC)
    deal = FlashDeal(
        name=name,
        starts_at=(now + timedelta(hours=starts_in)) if starts_in is not None else now - timedelta(minutes=5),
        ends_at=(now + timedelta(hours=ends_in)) if ends_in is not None else now + timedelta(hours=hours),
        is_active=active,
    )
    db.add(deal)
    db.commit()
    db.refresh(deal)
    # Tests write deals straight to the DB (bypassing the admin service), so
    # drop the shared strip cache here or a warm [] would hide the new deal.
    invalidate_flash_cache()
    return deal


def _deal_item(db, deal, variant, *, price=None, percent=None, limit=10, sold=0, per_user=None):
    from app.modules.flash.models import FlashDealItem
    from app.modules.flash.service import invalidate_flash_cache

    item = FlashDealItem(
        deal_id=deal.id,
        variant_id=variant.id,
        deal_price=Decimal(price) if price is not None else None,
        deal_percent=Decimal(percent) if percent is not None else None,
        deal_stock_limit=limit,
        deal_stock_sold=sold,
        per_user_limit=per_user,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    invalidate_flash_cache()
    return item


def _rule(db, product, *, percent="10"):
    from app.modules.discounts.models import Discount, DiscountKind, DiscountScope

    rule = Discount(
        scope=DiscountScope.PRODUCT,
        kind=DiscountKind.PERCENT,
        value=Decimal(percent),
        product_id=product.id,
        is_active=True,
    )
    db.add(rule)
    db.commit()
    return rule


def _coupon(db, **overrides):
    from app.modules.discounts.models import Coupon, CouponKind

    spec = dict(
        code="STACK10",
        kind=CouponKind.PERCENT,
        value=Decimal("10"),
        min_subtotal=Decimal("0"),
        is_active=True,
    )
    spec.update(overrides)
    coupon = Coupon(**spec)
    db.add(coupon)
    db.commit()
    db.refresh(coupon)
    return coupon


def _spec(**overrides):
    from app.modules.discounts.pricing import CouponSpec

    data = dict(id=1, code="STACK10", kind="percent", value=Decimal("10"))
    data.update(overrides)
    return CouponSpec(**data)


# --------------------------------------------------------------------------- #
# Engine maths (no HTTP, no DB)
# --------------------------------------------------------------------------- #
def test_flash_auto_and_coupon_stack_and_arithmetic_adds_up():
    from app.modules.discounts.pricing import price_cart

    pricing = price_cart(
        [(Decimal("100"), 1), (Decimal("200"), 1)],
        _spec(value=Decimal("10")),
        auto_discount=Decimal("30"),
        flash_discount=Decimal("20"),
        flash_value=Decimal("80"),
    )
    assert pricing.subtotal == Decimal("300.00")
    assert pricing.flash_discount == Decimal("20.00")
    assert pricing.auto_discount == Decimal("30.00")
    # coupon: 10% of goods (300 - 20 - 30 = 250) -> 25
    assert pricing.discount == Decimal("25.00")
    assert pricing.payable == Decimal("225.00")
    assert pricing.total == Decimal("265.00")  # 225 + 40 delivery
    assert pricing.total_discount == Decimal("75.00")  # flash + auto + coupon
    assert pricing.total == (
        pricing.subtotal - pricing.flash_discount - pricing.auto_discount - pricing.discount
    ) + pricing.delivery


def test_excluding_coupon_only_touches_non_flash_goods():
    from app.modules.discounts.pricing import price_cart

    pricing = price_cart(
        [(Decimal("100"), 1), (Decimal("200"), 1)],
        _spec(value=Decimal("10"), exclude_flash_deals=True),
        flash_discount=Decimal("20"),
        flash_value=Decimal("80"),
    )
    # goods = 280; coupon base = 280 - 80 (flash value) = 200 -> 10% = 20
    assert pricing.discount == Decimal("20.00")
    assert pricing.total == Decimal("260.00") + Decimal("40.00")


def test_regular_coupon_discounts_whole_basket_including_flash():
    from app.modules.discounts.pricing import price_cart

    pricing = price_cart(
        [(Decimal("100"), 1), (Decimal("200"), 1)],
        _spec(value=Decimal("10")),
        flash_discount=Decimal("20"),
        flash_value=Decimal("80"),
    )
    # goods = 280; no exclusion -> 10% of 280 = 28
    assert pricing.discount == Decimal("28.00")


def test_flash_and_auto_layers_cannot_exceed_the_subtotal():
    from app.modules.discounts.pricing import price_cart

    pricing = price_cart(
        [(Decimal("100.00"), 1)],
        auto_discount=Decimal("60"),
        flash_discount=Decimal("80"),
    )
    assert pricing.flash_discount == Decimal("80.00")
    assert pricing.auto_discount == Decimal("20.00")  # capped at what is left
    assert pricing.payable == Decimal("0.00")


def test_free_delivery_coupon_survives_flash_exclusion():
    from app.modules.discounts.pricing import price_cart

    pricing = price_cart(
        [(Decimal("100"), 1)],
        _spec(kind="free_delivery", exclude_flash_deals=True),
        flash_discount=Decimal("20"),
        flash_value=Decimal("80"),
    )
    assert pricing.delivery == Decimal("0.00")
    assert pricing.coupon_value == Decimal("40.00")
    assert pricing.discount == Decimal("0.00")


# --------------------------------------------------------------------------- #
# Cart contract
# --------------------------------------------------------------------------- #
def test_cart_shows_deal_price_and_flash_discount(client, db, seed_catalog, customer):
    deal = _deal(db)
    _deal_item(db, deal, seed_catalog["large"], price="80.00")

    headers = login(client, customer)
    added = client.post(
        "/api/cart/items", json={"variant_id": seed_catalog["large"].id, "quantity": 1},
        headers=headers,
    )
    assert added.status_code == 201, added.text

    body = client.get("/api/cart", headers=headers).json()
    (line,) = body["items"]
    assert line["deal_price"] == 80.0
    assert line["unit_price"] == 180.0
    assert body["flash_discount"] == 100.0
    # 180 - 100 (flash) + 40 delivery
    assert body["total"] == 120.0


def test_flash_beats_the_automatic_discount_layer(client, db, seed_catalog, customer):
    _rule(db, seed_catalog["product"], percent="10")

    headers = login(client, customer)
    client.post(
        "/api/cart/items", json={"variant_id": seed_catalog["large"].id, "quantity": 1},
        headers=headers,
    )

    # Rule alone: 10% off 180.
    body = client.get("/api/cart", headers=headers).json()
    assert body["auto_discount"] == 18.0
    assert body["flash_discount"] == 0.0

    deal = _deal(db)
    _deal_item(db, deal, seed_catalog["large"], price="80.00")

    # Deal claims the line: no double-dipping, flash is the only cut.
    body = client.get("/api/cart", headers=headers).json()
    assert body["flash_discount"] == 100.0
    assert body["auto_discount"] == 0.0
    assert body["total"] == 120.0


def test_coupon_stacks_on_top_of_flash(client, db, seed_catalog, customer):
    _coupon(db, code="STACK10")
    deal = _deal(db)
    _deal_item(db, deal, seed_catalog["large"], price="80.00")

    headers = login(client, customer)
    client.post(
        "/api/cart/items", json={"variant_id": seed_catalog["large"].id, "quantity": 1},
        headers=headers,
    )
    applied = client.post("/api/cart/coupon", json={"code": "STACK10"}, headers=headers)
    assert applied.status_code == 200, applied.text

    body = client.get("/api/cart", headers=headers).json()
    # goods = 180 - 100 = 80; coupon 10% of 80 = 8
    assert body["flash_discount"] == 100.0
    assert body["discount"] == 8.0
    assert body["total"] == 72.0 + 40.0


def test_excluding_coupon_ignores_the_flash_part_of_the_basket(client, db, seed_catalog, customer):
    _coupon(db, code="NOFLASH", exclude_flash_deals=True)
    deal = _deal(db)
    _deal_item(db, deal, seed_catalog["large"], price="80.00")

    headers = login(client, customer)
    client.post(
        "/api/cart/items", json={"variant_id": seed_catalog["large"].id, "quantity": 1},
        headers=headers,
    )
    client.post(
        "/api/cart/items", json={"variant_id": seed_catalog["small"].id, "quantity": 1},
        headers=headers,
    )
    assert client.post("/api/cart/coupon", json={"code": "NOFLASH"}, headers=headers).status_code == 200

    body = client.get("/api/cart", headers=headers).json()
    # subtotal 280, flash 100 -> goods 180; coupon base = 180 - 80 = 100 -> 10
    assert body["flash_discount"] == 100.0
    assert body["discount"] == 10.0
    assert body["total"] == 170.0 + 40.0


def test_exhausted_deal_falls_back_silently(client, db, seed_catalog, customer):
    deal = _deal(db)
    _deal_item(db, deal, seed_catalog["large"], price="80.00", limit=5, sold=5)

    headers = login(client, customer)
    client.post(
        "/api/cart/items", json={"variant_id": seed_catalog["large"].id, "quantity": 1},
        headers=headers,
    )
    body = client.get("/api/cart", headers=headers).json()
    assert body["items"][0]["deal_price"] is None
    assert body["flash_discount"] == 0.0
    assert body["total"] == 180.0 + 40.0  # regular pricing, no error, no badge


def test_deal_window_and_switch_gates_the_price(client, db, seed_catalog, customer):
    headers = login(client, customer)
    client.post(
        "/api/cart/items", json={"variant_id": seed_catalog["large"].id, "quantity": 1},
        headers=headers,
    )

    cases = [
        {"active": False, "hours": 6},
        {"active": True, "hours": -1},  # already ended
        {"active": True, "hours": 6, "starts_in": 2},  # not started yet
    ]
    for case in cases:
        starts_in = case.pop("starts_in", None)
        deal = _deal(db, active=case["active"], hours=case["hours"], starts_in=starts_in)
        _deal_item(db, deal, seed_catalog["large"], price="80.00")
        body = client.get("/api/cart", headers=headers).json()
        assert body["flash_discount"] == 0.0, case
        db.delete(deal)
        db.commit()


# --------------------------------------------------------------------------- #
# Checkout: the claim
# --------------------------------------------------------------------------- #
def test_checkout_claims_deal_stock_and_prices_the_order(client, db, seed_catalog, customer):
    deal = _deal(db)
    item = _deal_item(db, deal, seed_catalog["large"], price="80.00", limit=10)

    headers = login(client, customer)
    client.post(
        "/api/cart/items", json={"variant_id": seed_catalog["large"].id, "quantity": 2},
        headers=headers,
    )
    summary = client.get("/api/checkout/summary", headers=headers).json()
    assert summary["flash_discount"] == 200.0

    placed = client.post(
        "/api/checkout",
        json={"address": ADDRESS, "payment_method": "cod", "delivery_method": "standard"},
        headers=headers,
    )
    assert placed.status_code == 201, placed.text

    db.expire_all()
    from app.modules.flash.models import FlashDealItem
    from app.modules.orders.models import OrderItem

    claimed = db.get(FlashDealItem, item.id)
    assert claimed.deal_stock_sold == 2

    order_items = (
        db.query(OrderItem).filter(OrderItem.order_id == placed.json()["id"]).all()
    )
    assert [row.flash_deal_item_id for row in order_items] == [item.id]
    order = placed.json()
    assert order["discount_total"] == 200.0
    # 2 × 180 - 200 flash + 40 delivery
    assert order["total"] == 200.0


def test_checkout_summary_carries_flash_row(client, db, seed_catalog, customer):
    deal = _deal(db)
    _deal_item(db, deal, seed_catalog["large"], price="80.00")
    headers = login(client, customer)
    client.post(
        "/api/cart/items", json={"variant_id": seed_catalog["large"].id, "quantity": 1},
        headers=headers,
    )
    summary = client.get("/api/checkout/summary", headers=headers).json()
    assert summary["flash_discount"] == 100.0
    assert summary["items"][0]["deal_price"] == 80.0


def test_deal_stock_race_one_wins(client, db, seed_catalog):
    """Two customers race for the last deal unit: the counter never oversells.

    The loser's outcome depends on when its own read happened — 409 when it
    had the deal in its cart view and lost the claim, or a silently re-priced
    (regular) order when it read after the winner committed, which is the
    spec'd sold-out fallback. Either way: exactly one claim, one deal unit.
    """
    from app.modules.flash.models import FlashDealItem
    from app.modules.orders.models import Order, OrderItem

    deal = _deal(db)
    item = _deal_item(db, deal, seed_catalog["large"], price="80.00", limit=1)

    lock = threading.Lock()
    results = []
    ready = threading.Barrier(2)

    def race(email: str) -> None:
        with TestClient(app=client.app, base_url="http://testserver") as racer:
            registered = racer.post(
                "/api/auth/register",
                json={"email": email, "password": PASSWORD, "full_name": "Racer"},
            )
            assert registered.status_code == 201, registered.text
            headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
            added = racer.post(
                "/api/cart/items",
                json={"variant_id": seed_catalog["large"].id, "quantity": 1},
                headers=headers,
            )
            assert added.status_code == 201, added.text
            ready.wait(timeout=30)
            response = racer.post(
                "/api/checkout",
                json={
                    "address": ADDRESS,
                    "payment_method": "cod",
                    "delivery_method": "standard",
                },
                headers=headers,
            )
            with lock:
                results.append(response)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(race, ["flashracer1@test.dev", "flashracer2@test.dev"]))

    codes = sorted(r.status_code for r in results)
    assert codes[0] == 201 and codes[1] in (201, 409), codes

    db.expire_all()
    # The invariant: one deal unit sold, no matter how the race interleaved.
    assert db.get(FlashDealItem, item.id).deal_stock_sold == 1

    orders = db.query(Order).filter(Order.status != "cancelled").all()
    assert 1 <= len(orders) <= 2
    flash_orders = [
        row
        for row in db.query(OrderItem)
        .filter(OrderItem.order_id.in_([o.id for o in orders]))
        .all()
        if row.flash_deal_item_id == item.id
    ]
    # Exactly one order claimed the deal; any re-priced loser did not.
    assert len(flash_orders) == 1
    if len(orders) == 2:
        winner = next(o for o in orders if o.id == flash_orders[0].order_id)
        loser = next(o for o in orders if o.id != winner.id)
        assert winner.discount_total == Decimal("100.00")
        assert loser.discount_total == Decimal("0.00")


def test_stale_cart_read_cannot_claim_a_taken_unit(db, session_factory, seed_catalog):
    """Deterministic version of the race's 409 branch: a checkout whose read
    saw the deal still available must lose cleanly when a concurrent buyer
    took the last unit — the conditional UPDATE refuses, nothing is written."""
    from app.core.exceptions import ConflictError
    from app.core.security import hash_password
    from app.modules.cart.models import Cart, CartItem
    from app.modules.flash import service as flash_service
    from app.modules.flash.models import FlashDealItem
    from app.modules.orders import service as orders_service
    from app.modules.orders.schemas import AddressIn, CheckoutIn
    from app.modules.users.models import User, UserRole

    def _user(email: str, session):
        user = User(
            email=email,
            full_name="Racer",
            password_hash=hash_password(PASSWORD),
            role=UserRole.CUSTOMER,
        )
        session.add(user)
        session.flush()
        cart = Cart(user_id=user.id)
        session.add(cart)
        session.flush()
        session.add(
            CartItem(cart_id=cart.id, variant_id=seed_catalog["large"].id, quantity=1)
        )
        session.flush()
        return user, cart

    buyer_a, cart_a = _user("stale-a@test.dev", db)
    deal = _deal(db)
    item = _deal_item(db, deal, seed_catalog["large"], price="80.00", limit=1)

    # A reads its cart view: the deal is available.
    flash_a = flash_service.flash_cart(db, cart_a)
    assert not flash_a.empty

    # B buys the last unit through the real checkout in its own session.
    other = session_factory()
    try:
        buyer_b, cart_b = _user("stale-b@test.dev", other)
        orders_service.checkout(
            other,
            buyer_b,
            cart_b,
            CheckoutIn(
                payment_method="cod",
                address=AddressIn(**ADDRESS),
                delivery_method="standard",
            ),
        )
        other.commit()
    finally:
        other.close()

    db.expire_all()
    assert db.get(FlashDealItem, item.id).deal_stock_sold == 1

    # A's stale claim: the guard refuses and A's transaction rolls back.
    with pytest.raises(ConflictError):
        flash_service.claim_for_checkout(db, buyer_a, cart_a, flash_a)
    db.rollback()

    db.expire_all()
    assert db.get(FlashDealItem, item.id).deal_stock_sold == 1


def test_per_user_limit_blocks_a_second_buy(client, db, seed_catalog, customer):
    deal = _deal(db)
    item = _deal_item(db, deal, seed_catalog["large"], price="80.00", limit=10, per_user=1)

    headers = login(client, customer)
    client.post(
        "/api/cart/items", json={"variant_id": seed_catalog["large"].id, "quantity": 1},
        headers=headers,
    )
    first = client.post(
        "/api/checkout",
        json={"address": ADDRESS, "payment_method": "cod", "delivery_method": "standard"},
        headers=headers,
    )
    assert first.status_code == 201, first.text

    client.post(
        "/api/cart/items", json={"variant_id": seed_catalog["large"].id, "quantity": 1},
        headers=headers,
    )
    second = client.post(
        "/api/checkout",
        json={"address": ADDRESS, "payment_method": "cod", "delivery_method": "standard"},
        headers=headers,
    )
    assert second.status_code == 409
    assert "at most 1" in second.json()["error"]["message"]

    db.expire_all()
    from app.modules.flash.models import FlashDealItem

    assert db.get(FlashDealItem, item.id).deal_stock_sold == 1


# --------------------------------------------------------------------------- #
# Release: cancel, sweeper, idempotency
# --------------------------------------------------------------------------- #
def test_cancel_releases_deal_stock_exactly_once(client, db, seed_catalog, customer):
    deal = _deal(db)
    item = _deal_item(db, deal, seed_catalog["large"], price="80.00", limit=10)

    headers = login(client, customer)
    client.post(
        "/api/cart/items", json={"variant_id": seed_catalog["large"].id, "quantity": 1},
        headers=headers,
    )
    placed = client.post(
        "/api/checkout",
        json={"address": ADDRESS, "payment_method": "cod", "delivery_method": "standard"},
        headers=headers,
    )
    assert placed.status_code == 201, placed.text
    order_id = placed.json()["id"]

    cancelled = client.post(f"/api/orders/{order_id}/cancel", headers=headers)
    assert cancelled.status_code == 200, cancelled.text

    db.expire_all()
    from app.modules.flash.models import FlashDealItem
    from app.modules.flash.service import release_for_order
    from app.modules.orders.models import Order

    assert db.get(FlashDealItem, item.id).deal_stock_sold == 0

    # Someone else buys the freed unit, then a racing path tries to release
    # the cancelled order again: the flag under the order lock says no.
    order = db.get(Order, order_id)
    assert order.flash_released is True
    release_for_order(db, order)
    db.commit()
    db.expire_all()
    assert db.get(FlashDealItem, item.id).deal_stock_sold == 0


def test_sweeper_releases_deal_stock_on_payment_timeout(db, seed_catalog):
    from sqlalchemy import update

    from app.core.security import hash_password
    from app.modules.cart.models import Cart, CartItem
    from app.modules.flash.models import FlashDealItem
    from app.modules.inventory.models import StockReservation
    from app.modules.orders import service as orders_service
    from app.modules.orders import tasks as order_tasks
    from app.modules.orders.models import Order, OrderStatus
    from app.modules.orders.schemas import AddressIn, CheckoutIn
    from app.modules.users.models import User, UserRole

    user = User(
        email="flashsweep@test.dev",
        full_name="Sweep",
        password_hash=hash_password(PASSWORD),
        role=UserRole.CUSTOMER,
    )
    db.add(user)
    db.flush()

    deal = _deal(db)
    item = _deal_item(db, deal, seed_catalog["large"], price="80.00", limit=10)

    cart = Cart(user_id=user.id)
    db.add(cart)
    db.flush()
    db.add(CartItem(cart_id=cart.id, variant_id=seed_catalog["large"].id, quantity=1))
    db.flush()

    placed = orders_service.checkout(
        db,
        user,
        cart,
        CheckoutIn(
            payment_method="zarinpal",
            address=AddressIn(**ADDRESS),
            delivery_method="standard",
        ),
    )
    db.expire_all()
    assert db.get(FlashDealItem, item.id).deal_stock_sold == 1

    # Age the reservations into the past, then sweep.
    db.execute(
        update(StockReservation)
        .where(StockReservation.order_id == placed.id)
        .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        .execution_options(synchronize_session=False)
    )
    db.commit()

    summary = order_tasks.sweep_expired_reservations(db)
    assert summary["cancelled"] == 1

    db.expire_all()
    assert db.get(Order, placed.id).status == OrderStatus.CANCELLED
    assert db.get(FlashDealItem, item.id).deal_stock_sold == 0


# --------------------------------------------------------------------------- #
# Public strip payload
# --------------------------------------------------------------------------- #
def test_active_deals_payload(client, db, seed_catalog, customer):
    # Nothing live yet: the strip hides.
    assert client.get("/api/deals/active").json() == []

    deal = _deal(db)
    item = _deal_item(db, deal, seed_catalog["large"], price="80.00", limit=10, sold=4)

    body = client.get("/api/deals/active").json()
    (entry,) = body
    assert entry["name"] == "Flash Friday"
    assert entry["ends_at"] is not None
    (line,) = entry["items"]
    assert line["variant_id"] == seed_catalog["large"].id
    assert line["product_slug"] == "test-oats"
    assert line["list_price"] == "180.00"
    assert line["deal_price"] == "80.00"
    assert line["remaining"] == 6
    assert line["claimed_percent"] == "40.00"
    # Guests get no per-user data: the response model carries the key as null.
    assert line["per_user_remaining"] is None

    # Signed-in with a limit: the strip knows how many more they may buy.
    _deal_item(db, deal, seed_catalog["small"], percent="10", limit=5, per_user=2)
    headers = login(client, customer)
    body = client.get("/api/deals/active", headers=headers).json()
    small = next(i for i in body[0]["items"] if i["variant_id"] == seed_catalog["small"].id)
    assert small["per_user_remaining"] == 2

    # Exhausted deals vanish entirely (strip-hidden signal).
    db.expire_all()
    row = db.get(type(item), item.id)
    row.deal_stock_sold = row.deal_stock_limit
    small_row = (
        db.query(type(item)).filter(type(item).deal_id == deal.id, type(item).id != item.id).one()
    )
    small_row.deal_stock_sold = small_row.deal_stock_limit
    db.commit()
    from app.modules.flash.service import invalidate_flash_cache

    invalidate_flash_cache()
    assert client.get("/api/deals/active").json() == []


def test_end_early_hides_the_deal_from_the_strip(client, db, seed_catalog, admin_user):
    deal = _deal(db, hours=6)
    _deal_item(db, deal, seed_catalog["large"], price="80.00")

    headers = login(client, admin_user)
    ended = client.post(f"/api/admin/flash-deals/{deal.id}/end", headers=headers)
    assert ended.status_code == 200, ended.text
    assert ended.json()["status"] == "ended"

    assert client.get("/api/deals/active").json() == []


# --------------------------------------------------------------------------- #
# Admin CRUD
# --------------------------------------------------------------------------- #
def test_admin_deal_crud_with_list_filters(client, db, seed_catalog, admin_user):
    headers = login(client, admin_user)
    created = client.post(
        "/api/admin/flash-deals",
        json={
            "name": "Monsoon Sale",
            "starts_at": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
            "ends_at": (datetime.now(UTC) + timedelta(hours=3)).isoformat(),
            "is_active": True,
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    deal_id = created.json()["id"]
    assert created.json()["status"] == "live"

    # Bad windows are rejected up front.
    bad = client.post(
        "/api/admin/flash-deals",
        json={
            "name": "Backwards",
            "starts_at": (datetime.now(UTC) + timedelta(hours=3)).isoformat(),
            "ends_at": (datetime.now(UTC)).isoformat(),
        },
        headers=headers,
    )
    assert bad.status_code == 422

    listed = client.get(
        "/api/admin/flash-deals",
        params={"q": "monsoon", "status": "live", "sort": "name", "page": 1, "page_size": 10},
        headers=headers,
    )
    assert listed.status_code == 200
    page = listed.json()
    assert page["total"] == 1
    assert page["items"][0]["id"] == deal_id

    renamed = client.patch(
        f"/api/admin/flash-deals/{deal_id}",
        json={
            "name": "Monsoon Mega Sale",
            "starts_at": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
            "ends_at": (datetime.now(UTC) + timedelta(hours=3)).isoformat(),
            "is_active": True,
        },
        headers=headers,
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Monsoon Mega Sale"

    removed = client.delete(f"/api/admin/flash-deals/{deal_id}", headers=headers)
    assert removed.status_code == 204
    assert client.get(f"/api/admin/flash-deals/{deal_id}", headers=headers).status_code == 404


def test_admin_item_management_and_validations(client, db, seed_catalog, admin_user):
    headers = login(client, admin_user)
    deal = client.post(
        "/api/admin/flash-deals",
        json={"name": "Items Deal", "is_active": True},
        headers=headers,
    ).json()
    deal_id = deal["id"]

    # exactly one of price/percent
    both = client.post(
        f"/api/admin/flash-deals/{deal_id}/items",
        json={
            "variant_id": seed_catalog["large"].id,
            "deal_price": "80",
            "deal_percent": "10",
            "deal_stock_limit": 5,
        },
        headers=headers,
    )
    assert both.status_code == 422
    neither = client.post(
        f"/api/admin/flash-deals/{deal_id}/items",
        json={"variant_id": seed_catalog["large"].id, "deal_stock_limit": 5},
        headers=headers,
    )
    assert neither.status_code == 422

    # price must actually beat the list price
    too_high = client.post(
        f"/api/admin/flash-deals/{deal_id}/items",
        json={
            "variant_id": seed_catalog["large"].id,
            "deal_price": "200",
            "deal_stock_limit": 5,
        },
        headers=headers,
    )
    assert too_high.status_code == 409

    added = client.post(
        f"/api/admin/flash-deals/{deal_id}/items",
        json={
            "variant_id": seed_catalog["large"].id,
            "deal_percent": "20",
            "deal_stock_limit": 5,
            "per_user_limit": 2,
        },
        headers=headers,
    )
    assert added.status_code == 201, added.text
    row = added.json()
    # 180 − 20% = 144, sold 0, remaining 5
    assert row["effective_price"] == 144.0
    assert row["remaining"] == 5
    assert row["claimed_percent"] == 0.0
    assert row["product_name"] == "Test Oats"

    duplicate = client.post(
        f"/api/admin/flash-deals/{deal_id}/items",
        json={
            "variant_id": seed_catalog["large"].id,
            "deal_price": "90",
            "deal_stock_limit": 3,
        },
        headers=headers,
    )
    assert duplicate.status_code == 409

    # Variant search flags what a live deal already claims. "Items Deal" has
    # no window, which by design means "live now" — so the large variant is
    # claimed and the untouched small one is free.
    search = client.get(
        "/api/admin/flash-deals/variant-search", params={"q": "Oats"}, headers=headers
    )
    assert search.status_code == 200
    assert search.json()["total"] == 2
    claim_flags = {
        row["variant_id"]: row["in_live_deal"] for row in search.json()["items"]
    }
    assert claim_flags[seed_catalog["large"].id] == "Items Deal"
    assert claim_flags[seed_catalog["small"].id] is None

    # Live counter update + removal.
    item_id = row["id"]
    updated = client.patch(
        f"/api/admin/flash-deals/items/{item_id}",
        json={
            "variant_id": seed_catalog["large"].id,
            "deal_percent": "25",
            "deal_stock_limit": 8,
            "per_user_limit": 1,
        },
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["effective_price"] == 135.0
    assert updated.json()["stock_limit"] == 8

    deleted = client.delete(f"/api/admin/flash-deals/items/{item_id}", headers=headers)
    assert deleted.status_code == 204
    assert client.get(f"/api/admin/flash-deals/{deal_id}/items", headers=headers).json() == []


def test_admin_flash_endpoints_require_staff(client, db, seed_catalog, customer):
    headers = login(client, customer)
    assert client.get("/api/admin/flash-deals", headers=headers).status_code == 403
    assert (
        client.post(
            "/api/admin/flash-deals",
            json={"name": "Nope", "is_active": True},
            headers=headers,
        ).status_code
        == 403
    )


def test_sold_counter_never_written_from_admin(client, db, seed_catalog, admin_user):
    """A live item's sold/remaining preview comes from checkout's counter —
    editing an item may move the limit but never the sold count."""
    headers = login(client, admin_user)
    deal = client.post(
        "/api/admin/flash-deals", json={"name": "Counter", "is_active": True}, headers=headers
    ).json()
    added = client.post(
        f"/api/admin/flash-deals/{deal['id']}/items",
        json={
            "variant_id": seed_catalog["small"].id,
            "deal_price": "50",
            "deal_stock_limit": 4,
        },
        headers=headers,
    ).json()

    # Simulate sales (the checkout path) and then edit the item.
    from app.modules.flash.models import FlashDealItem

    db.expire_all()
    row = db.get(FlashDealItem, added["id"])
    row.deal_stock_sold = 3
    db.commit()

    updated = client.patch(
        f"/api/admin/flash-deals/items/{added['id']}",
        json={
            "variant_id": seed_catalog["small"].id,
            "deal_price": "60",
            "deal_stock_limit": 10,
            "per_user_limit": None,
        },
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["stock_sold"] == 3
    assert updated.json()["remaining"] == 7
