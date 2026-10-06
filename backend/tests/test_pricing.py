"""Pricing engine + coupon tests.

Three layers, because each can break on its own:
  * pure engine maths (rounding, caps, delivery rule) — no HTTP, no DB
  * the HTTP contract (apply/remove/validate, checkout persistence)
  * the redemption race — two customers, one remaining redemption
"""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
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


def _coupon(db, **overrides):
    from app.modules.discounts.models import Coupon, CouponKind

    spec = dict(
        code="TEST10",
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

    data = dict(id=1, code="TEST10", kind="percent", value=Decimal("10"))
    data.update(overrides)
    return CouponSpec(**data)


# --------------------------------------------------------------------------- #
# Engine maths (no HTTP, no DB)
# --------------------------------------------------------------------------- #


def test_percent_discount_rounds_half_up_to_paise():
    from app.modules.discounts.pricing import price_cart

    pricing = price_cart([(Decimal("199.99"), 1)], _spec(value=Decimal("7.5")))
    # 199.99 × 7.5% = 14.99925 -> 15.00 (not 14.99)
    assert pricing.discount == Decimal("15.00")
    assert pricing.payable == Decimal("184.99")
    assert pricing.delivery == Decimal("40.00")
    assert pricing.total == Decimal("224.99")
    # the printed arithmetic must always add up
    assert pricing.total == (pricing.subtotal - pricing.discount) + pricing.delivery


def test_fixed_discount_is_capped_at_the_subtotal():
    from app.modules.discounts.pricing import price_cart

    pricing = price_cart([(Decimal("60.00"), 1)], _spec(kind="fixed", value=Decimal("500")))
    assert pricing.discount == Decimal("60.00")  # never more than the basket
    assert pricing.payable == Decimal("0.00")
    assert pricing.total == Decimal("40.00")  # delivery still applies


def test_max_discount_caps_the_percentage():
    from app.modules.discounts.pricing import price_cart

    pricing = price_cart(
        [(Decimal("2500.00"), 1)], _spec(value=Decimal("10"), max_discount=Decimal("200"))
    )
    assert pricing.discount == Decimal("200.00")  # 10% would have been 250
    assert pricing.payable == Decimal("2300.00")
    assert pricing.delivery == Decimal("0.00")  # 2300 >= 999
    assert pricing.total == Decimal("2300.00")


def test_free_delivery_is_judged_on_the_discounted_amount():
    from app.modules.discounts.pricing import price_cart

    # Raw ₹1080 would ship free; after ₹100 off the customer pays on ₹980 and
    # therefore does not clear the ₹999 threshold.
    qualifies_not = price_cart([(Decimal("180.00"), 6)], _spec(kind="fixed", value=Decimal("100")))
    assert qualifies_not.subtotal == Decimal("1080.00")
    assert qualifies_not.discount == Decimal("100.00")
    assert qualifies_not.delivery == Decimal("40.00")
    assert qualifies_not.total == Decimal("1020.00")

    # Same coupon, discounted amount still clears the threshold -> free.
    qualifies = price_cart([(Decimal("180.00"), 7)], _spec(kind="fixed", value=Decimal("100")))
    assert qualifies.payable == Decimal("1160.00")
    assert qualifies.delivery == Decimal("0.00")
    assert qualifies.total == Decimal("1160.00")


def test_empty_cart_costs_nothing():
    from app.modules.discounts.pricing import price_cart

    pricing = price_cart([], _spec())
    assert pricing.subtotal == Decimal("0.00")
    assert pricing.discount == Decimal("0.00")
    assert pricing.delivery == Decimal("0.00")
    assert pricing.total == Decimal("0.00")
    assert pricing.has_coupon is False


def test_unknown_coupon_kind_discounts_nothing():
    from app.modules.discounts.pricing import discount_amount

    assert discount_amount(Decimal("100"), kind="bogus", value=Decimal("10")) == Decimal("0.00")


# --------------------------------------------------------------------------- #
# HTTP contract
# --------------------------------------------------------------------------- #


def test_apply_coupon_updates_cart_totals(client, db, customer, seed_catalog):
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)  # 540
    _coupon(db, min_subtotal=Decimal("499"), max_discount=Decimal("200"))

    # whitespace and case are not the customer's problem
    applied = client.post("/api/cart/coupon", json={"code": "  test10 "}, headers=headers)
    assert applied.status_code == 200, applied.text
    body = applied.json()
    assert body["coupon"]["code"] == "TEST10"
    assert body["coupon"]["kind"] == "percent"
    assert body["subtotal"] == 540
    assert body["discount"] == 54  # 10% of 540, under the ₹200 cap
    assert body["delivery_fee"] == 40  # 486 < 999
    assert body["total"] == 526  # 486 + 40

    stored = client.get("/api/cart", headers=headers).json()
    assert stored["coupon"]["code"] == "TEST10"
    assert stored["discount"] == 54


def test_unknown_coupon_is_rejected_with_a_reason(client, customer, seed_catalog):
    headers = login(client, customer)
    response = client.post("/api/cart/coupon", json={"code": "NOPE"}, headers=headers)
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "That coupon code doesn't exist"


def test_coupon_below_minimum_says_how_much_is_missing(client, db, customer, seed_catalog):
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)  # 540
    _coupon(db, code="BIG", kind="fixed", value=Decimal("100"), min_subtotal=Decimal("999"))

    response = client.post("/api/cart/coupon", json={"code": "BIG"}, headers=headers)
    assert response.status_code == 409
    assert response.json()["error"]["message"] == "Add ₹459.00 more to use this coupon."


def test_expired_upcoming_and_inactive_coupons_are_rejected(client, db, customer, seed_catalog):
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)
    now = datetime.now(UTC)

    cases = [
        (_coupon(db, code="PAST", ends_at=now - timedelta(days=1)), "This coupon has expired"),
        (
            _coupon(db, code="SOON", starts_at=now + timedelta(days=1)),
            "This coupon isn't active yet",
        ),
        (_coupon(db, code="OFF", is_active=False), "This coupon is no longer active"),
    ]
    for coupon, message in cases:
        response = client.post("/api/cart/coupon", json={"code": coupon.code}, headers=headers)
        assert response.status_code == 409, response.text
        assert response.json()["error"]["message"] == message


def test_coupon_is_cleared_when_the_cart_stops_qualifying(client, db, customer, seed_catalog):
    """Auto-clearing: a coupon that no longer applies disappears from the totals
    instead of silently over- or under-charging at checkout."""
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 6}, headers=headers)  # 1080
    _coupon(db, code="FLAT100", kind="fixed", value=Decimal("100"), min_subtotal=Decimal("999"))

    applied = client.post("/api/cart/coupon", json={"code": "FLAT100"}, headers=headers)
    assert applied.json()["discount"] == 100

    cart = client.get("/api/cart", headers=headers).json()
    patched = client.patch(
        f"/api/cart/items/{cart['items'][0]['id']}", json={"quantity": 3}, headers=headers
    )
    assert patched.status_code == 200
    assert patched.json()["coupon"] is None
    assert patched.json()["discount"] == 0
    assert patched.json()["delivery_fee"] == 40  # back to plain 540 + 40

    # ...and the clear is persisted, not just omitted from one response
    assert client.get("/api/cart", headers=headers).json()["coupon"] is None


def test_remove_coupon_restores_the_plain_totals(client, db, customer, seed_catalog):
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)
    _coupon(db)
    assert (
        client.post("/api/cart/coupon", json={"code": "TEST10"}, headers=headers).json()["discount"]
        == 54
    )

    removed = client.delete("/api/cart/coupon", headers=headers)
    assert removed.status_code == 200, removed.text
    body = removed.json()
    assert body["coupon"] is None
    assert body["discount"] == 0
    assert body["total"] == 580  # 540 + 40, back to no coupon


def test_guest_cart_can_apply_a_coupon(client, db, seed_catalog):
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3})
    _coupon(db)
    applied = client.post("/api/cart/coupon", json={"code": "TEST10"})
    assert applied.status_code == 200, applied.text
    assert applied.json()["discount"] == 54


def test_checkout_persists_discount_and_records_the_redemption(client, db, customer, seed_catalog):
    from app.modules.discounts.models import Coupon, CouponRedemption

    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 6}, headers=headers)  # 1080
    coupon = _coupon(
        db, code="FLAT100", kind="fixed", value=Decimal("100"), min_subtotal=Decimal("999")
    )
    assert (
        client.post("/api/cart/coupon", json={"code": "FLAT100"}, headers=headers).status_code
        == 200
    )

    summary = client.get("/api/checkout/summary", headers=headers).json()
    response = client.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
    assert response.status_code == 201, response.text
    order = response.json()

    assert order["subtotal"] == 1080
    assert order["discount_total"] == 100
    assert order["delivery_fee"] == 40  # 980 after discount -> below the threshold
    assert order["total"] == 1020
    assert order["coupon_code"] == "FLAT100"

    # what the customer was shown is exactly what they were charged
    assert summary["subtotal"] == order["subtotal"]
    assert summary["discount"] == order["discount_total"]
    assert summary["total"] == order["total"]

    detail = client.get(f"/api/orders/{order['id']}", headers=headers).json()
    assert detail["discount_total"] == 100
    assert detail["coupon_code"] == "FLAT100"

    # The cart comes back emptied *and* released from the code — an emptied cart
    # must not carry the redeemed code into the customer's next session.
    after = client.get("/api/cart", headers=headers).json()
    assert after["item_count"] == 0
    assert after["coupon"] is None
    assert after["discount"] == 0

    db.expire_all()
    assert db.get(Coupon, coupon.id).used_count == 1
    redemptions = db.scalars(select(CouponRedemption)).all()
    assert len(redemptions) == 1
    assert redemptions[0].discount_amount == Decimal("100")
    assert redemptions[0].order_id == order["id"]


def test_checkout_rejects_a_coupon_that_ran_out_between_apply_and_pay(
    client, db, customer, seed_catalog
):
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)
    coupon = _coupon(db, code="ONEONLY", kind="fixed", value=Decimal("50"), usage_limit=1)
    assert (
        client.post("/api/cart/coupon", json={"code": "ONEONLY"}, headers=headers).status_code
        == 200
    )

    # Somebody else takes the last redemption while this cart sits open.
    from app.modules.discounts.models import Coupon, CouponRedemption

    db.expire_all()
    db.get(Coupon, coupon.id).used_count = 1
    db.commit()

    response = client.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
    assert response.status_code == 409, response.text
    assert response.json()["error"]["message"] == "This coupon has been fully redeemed"

    # nothing was written: no order, no redemption, cart untouched
    db.expire_all()
    from app.modules.orders.models import Order

    assert db.scalar(select(func.count()).select_from(Order)) == 0
    assert db.scalar(select(func.count()).select_from(CouponRedemption)) == 0
    assert client.get("/api/cart", headers=headers).json()["coupon"] is None


def test_per_user_limit_blocks_the_second_order(client, db, customer, seed_catalog):
    headers = login(client, customer)
    _coupon(db, code="ONCE", kind="fixed", value=Decimal("50"), per_user_limit=1)

    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)
    client.post("/api/cart/coupon", json={"code": "ONCE"}, headers=headers)
    first = client.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
    assert first.status_code == 201, first.text

    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)
    second = client.post("/api/cart/coupon", json={"code": "ONCE"}, headers=headers)
    assert second.status_code == 409, second.text
    assert second.json()["error"]["message"] == "You've already used this coupon"


def test_legacy_orders_and_carts_without_a_coupon_still_price(client, customer, seed_catalog):
    """discount_total defaults to 0 for anything created before this feature."""
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)
    order = client.post("/api/checkout", json={"address": ADDRESS}, headers=headers).json()
    assert order["discount_total"] == 0
    assert order["coupon_code"] is None
    assert order["total"] == 580


# --------------------------------------------------------------------------- #
# Concurrency: two customers, one remaining redemption
# --------------------------------------------------------------------------- #


def test_concurrent_redemption_only_one_customer_wins(client, db, seed_catalog):
    """The usage limit is claimed with a conditional UPDATE inside the checkout
    transaction, so of two simultaneous last-use redemptions exactly one commits."""
    from app.modules.discounts.models import Coupon, CouponKind, CouponRedemption
    from app.modules.orders.models import Order

    db.expire_all()
    _coupon(db, code="LAST1", kind=CouponKind.FIXED, value=Decimal("50"), usage_limit=1)

    results = []
    lock = threading.Lock()
    ready = threading.Barrier(2)

    def race(email: str, variant_id: int) -> None:
        with TestClient(app=client.app, base_url="http://testserver") as racer:
            registered = racer.post(
                "/api/auth/register",
                json={"email": email, "password": PASSWORD, "full_name": "Racer"},
            )
            assert registered.status_code == 201, registered.text
            headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
            # Different variants on purpose: the stock rows must not be the
            # thing serialising them, or the coupon guard is never exercised.
            add = racer.post(
                "/api/cart/items", json={"variant_id": variant_id, "quantity": 1}, headers=headers
            )
            assert add.status_code == 201, add.text
            applied = racer.post("/api/cart/coupon", json={"code": "LAST1"}, headers=headers)
            assert applied.status_code == 200, applied.text
            ready.wait(timeout=30)
            response = racer.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
            with lock:
                results.append(response)

    with ThreadPoolExecutor(max_workers=2) as pool:
        racers = [("couponracer1@test.dev", 2), ("couponracer2@test.dev", 1)]
        list(pool.map(lambda pair: race(*pair), racers))

    codes = sorted(r.status_code for r in results)
    assert codes == [201, 409], [r.status_code for r in results]
    loser = next(r for r in results if r.status_code == 409)
    assert loser.json()["error"]["message"] == "This coupon has been fully redeemed"

    db.expire_all()
    coupon = db.scalar(select(Coupon).where(Coupon.code == "LAST1"))
    assert coupon.used_count == 1, "usage limit must not overshoot under contention"
    assert db.scalar(select(func.count()).select_from(CouponRedemption)) == 1
    assert db.scalar(select(func.count()).select_from(Order)) == 1


# --------------------------------------------------------------------------- #
# Automatic discounts (the layer before the coupon)
# --------------------------------------------------------------------------- #


def _discount(db, **overrides):
    from app.modules.discounts.models import Discount, DiscountKind, DiscountScope

    spec = dict(
        scope=DiscountScope.PRODUCT,
        kind=DiscountKind.PERCENT,
        value=Decimal("10"),
        is_active=True,
    )
    spec.update(overrides)
    row = Discount(**spec)
    db.add(row)
    db.commit()
    return row


def test_engine_applies_the_automatic_discount_before_the_coupon():
    from app.modules.discounts.pricing import price_cart

    pricing = price_cart([(Decimal("199.99"), 1)], None, auto_discount=Decimal("20"))
    assert pricing.auto_discount == Decimal("20.00")
    assert pricing.discount == Decimal("0.00")
    assert pricing.payable == Decimal("179.99")
    assert pricing.delivery == Decimal("40.00")
    assert pricing.total == Decimal("219.99")
    # printed arithmetic always adds up, now including the first layer
    assert pricing.total == (
        (pricing.subtotal - pricing.auto_discount - pricing.discount) + pricing.delivery
    )


def test_automatic_discount_is_capped_at_the_goods():
    from app.modules.discounts.pricing import price_cart

    pricing = price_cart([(Decimal("60.00"), 1)], None, auto_discount=Decimal("500"))
    assert pricing.auto_discount == Decimal("60.00")  # never more than the basket
    assert pricing.payable == Decimal("0.00")
    assert pricing.total == Decimal("40.00")  # delivery still applies


def test_product_discount_beats_the_category_discount(client, db, customer, seed_catalog):
    from app.modules.discounts.models import DiscountScope

    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)  # 540
    _discount(db, product_id=seed_catalog["product"].id, value=Decimal("10"))
    _discount(
        db,
        scope=DiscountScope.CATEGORY,
        category_id=seed_catalog["category"].id,
        value=Decimal("30"),
    )

    body = client.get("/api/cart", headers=headers).json()
    assert body["subtotal"] == 540
    assert body["auto_discount"] == 54  # 10% product rule beats the 30% category rule
    assert body["discount"] == 0  # no coupon involved
    assert body["total"] == 526  # 486 + 40 delivery


def test_best_single_rule_wins_and_fixed_pays_once_per_category(client, db, seed_catalog):
    from app.modules.discounts.models import DiscountKind, DiscountScope

    client.post("/api/cart/items", json={"variant_id": 1, "quantity": 1})  # 100
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 2})  # 360
    category_id = seed_catalog["category"].id

    ten = _discount(db, scope=DiscountScope.CATEGORY, category_id=category_id, value=Decimal("10"))
    twenty = _discount(
        db, scope=DiscountScope.CATEGORY, category_id=category_id, value=Decimal("20")
    )

    body = client.get("/api/cart").json()
    assert body["auto_discount"] == 92  # best single rule (20%), never stacked (30%)

    db.delete(ten)
    db.delete(twenty)
    db.commit()
    _discount(
        db,
        scope=DiscountScope.CATEGORY,
        category_id=category_id,
        kind=DiscountKind.FIXED,
        value=Decimal("50"),
    )
    body = client.get("/api/cart").json()
    assert body["auto_discount"] == 50  # fixed pays once per group, not per line


def test_automatic_discount_respects_its_window_and_active_flag(
    client, db, customer, seed_catalog
):
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)  # 540
    rule = _discount(db, product_id=seed_catalog["product"].id, is_active=False)

    def auto_now() -> float:
        return client.get("/api/cart", headers=headers).json()["auto_discount"]

    assert auto_now() == 0  # switched off

    now = datetime.now(UTC)
    rule.is_active = True
    rule.starts_at = now + timedelta(days=1)
    rule.ends_at = now + timedelta(days=8)
    db.commit()
    assert auto_now() == 0  # scheduled

    rule.starts_at = now - timedelta(days=8)
    rule.ends_at = now - timedelta(days=1)
    db.commit()
    assert auto_now() == 0  # expired

    rule.starts_at = now - timedelta(days=1)
    rule.ends_at = now + timedelta(days=1)
    db.commit()
    assert auto_now() == 54  # running now


def test_automatic_discount_then_coupon_order_of_operations(client, db, customer, seed_catalog):
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)  # 540
    _discount(db, product_id=seed_catalog["product"].id, value=Decimal("10"))  # 54 off
    _coupon(db, value=Decimal("10"))  # 10% of the remaining 486

    body = client.post("/api/cart/coupon", json={"code": "TEST10"}, headers=headers).json()
    assert body["auto_discount"] == 54
    assert body["discount"] == 48.6  # coupon applies after the automatic layer
    assert body["delivery_fee"] == 40  # 437.40 payable -> still below ₹999
    assert body["total"] == 477.4


def test_checkout_snapshots_both_discount_layers(client, db, customer, seed_catalog):
    from app.modules.discounts.models import CouponRedemption

    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)  # 540
    _discount(db, product_id=seed_catalog["product"].id, value=Decimal("10"))  # 54 off
    _coupon(db, value=Decimal("10"))  # 48.60 off
    assert (
        client.post("/api/cart/coupon", json={"code": "TEST10"}, headers=headers).status_code
        == 200
    )

    summary = client.get("/api/checkout/summary", headers=headers).json()
    response = client.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
    assert response.status_code == 201, response.text
    order = response.json()

    assert order["subtotal"] == 540
    assert order["discount_total"] == 102.6  # both layers snapshotted as the total off
    assert order["total"] == 477.4

    # what the customer was shown is exactly what they were charged
    assert summary["auto_discount"] == 54
    assert summary["discount"] == 48.6
    assert summary["total"] == order["total"]

    db.expire_all()
    redemption = db.scalar(select(CouponRedemption))
    assert redemption.discount_amount == Decimal("48.60")  # records the coupon only


def test_free_delivery_coupon_waives_the_delivery_line(client, db, customer, seed_catalog):
    from app.modules.discounts.models import Coupon, CouponKind, CouponRedemption

    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)  # 540
    _coupon(db, code="FREESHIP", kind=CouponKind.FREE_DELIVERY, value=Decimal("0"))

    body = client.post("/api/cart/coupon", json={"code": "FREESHIP"}, headers=headers).json()
    assert body["coupon"]["kind"] == "free_delivery"
    assert body["discount"] == 0  # nothing comes off the goods
    assert body["coupon"]["discount"] == 40  # ...but the delivery line is worth ₹40
    assert body["delivery_fee"] == 0
    assert body["total"] == 540

    order = client.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
    assert order.status_code == 201, order.text
    assert order.json()["delivery_fee"] == 0
    assert order.json()["total"] == 540

    db.expire_all()
    redemption = db.scalar(select(CouponRedemption))
    assert redemption.discount_amount == Decimal("40.00")  # usage records what it saved
    assert db.scalar(select(Coupon.used_count)) == 1


def test_a_no_op_free_delivery_code_is_not_applied_or_redeemed(
    client, db, customer, seed_catalog
):
    from app.modules.discounts.models import CouponKind, CouponRedemption

    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 6}, headers=headers)  # 1080
    _coupon(db, code="FREESHIP", kind=CouponKind.FREE_DELIVERY, value=Decimal("0"))

    # delivery is already free at ₹1080, so the code saves nothing and is not
    # shown as applied — and never claims a redemption slot.
    body = client.post("/api/cart/coupon", json={"code": "FREESHIP"}, headers=headers).json()
    assert body["coupon"] is None
    assert body["delivery_fee"] == 0
    assert body["total"] == 1080

    order = client.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
    assert order.status_code == 201, order.text
    assert order.json()["coupon_code"] is None

    db.expire_all()
    assert db.scalar(select(func.count()).select_from(CouponRedemption)) == 0
