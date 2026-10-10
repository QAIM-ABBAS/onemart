"""Delivery zones, slot booking, and the delivery-aware checkout.

Covers: zone matching (prefix/city, longest wins), bootstrap fallback to the
legacy flat fee, unserviceable addresses blocking checkout, zone pricing with
express/free-threshold/FREESHIP, slot states (available/limited/full/closed),
the booking cutoff, blocked dates, the slot-capacity race, and slot release on
cancellation (both admin cancel and the payment-timeout sweeper).
"""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

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


def _zone(db, name="Bengaluru Metro", postal=("560",), cities=("Bengaluru",),
          base="40", express="90", free_over="999", active=True):
    from app.modules.delivery.models import DeliveryZone

    zone = DeliveryZone(
        name=name,
        postal_codes=list(postal),
        cities=list(cities),
        base_fee=Decimal(base),
        express_fee=Decimal(express),
        free_delivery_threshold=Decimal(free_over) if free_over else None,
        is_active=active,
    )
    db.add(zone)
    db.commit()
    return zone


def _template(db, zone_id, weekday=None, start=time(9, 0), end=time(12, 0), capacity=2):
    from datetime import date as _date

    from app.modules.delivery.models import DeliverySlotTemplate

    if weekday is None:
        weekday = (_date.today() + timedelta(days=3)).weekday()
    template = DeliverySlotTemplate(
        zone_id=zone_id, weekday=weekday, start_time=start, end_time=end, capacity=capacity
    )
    db.add(template)
    db.commit()
    return template


def _future_slot(db, zone_id, days_ahead=3, start=time(9, 0), end=time(12, 0),
                 capacity=2, booked=0):
    from app.modules.delivery.models import DeliverySlot

    slot_date = datetime.now(UTC).date() + timedelta(days=days_ahead)
    slot = DeliverySlot(
        zone_id=zone_id,
        slot_date=slot_date,
        start_time=start,
        end_time=end,
        capacity=capacity,
        booked_count=booked,
    )
    db.add(slot)
    db.commit()
    return slot


# --------------------------------------------------------------------------
# Zone matching
# --------------------------------------------------------------------------
def test_zone_match_by_postal_prefix(client, db):
    zone = _zone(db)
    response = client.get("/api/delivery/zones/match", params={"postal_code": "560001"})
    assert response.status_code == 200
    body = response.json()
    assert body["serviceable"] is True
    assert body["zone"]["id"] == zone.id


def test_longest_postal_prefix_wins(client, db):
    wide = _zone(db, name="Wide", postal=("56",), cities=())
    tight = _zone(db, name="Tight", postal=("5600",), cities=())
    response = client.get("/api/delivery/zones/match", params={"postal_code": "560001"})
    assert response.json()["zone"]["id"] == tight.id
    # A pin outside the tight prefix still falls back to the wide zone.
    response = client.get("/api/delivery/zones/match", params={"postal_code": "561101"})
    assert response.json()["zone"]["id"] == wide.id


def test_zone_match_by_city_is_case_insensitive(client, db):
    zone = _zone(db, postal=(), cities=("Bengaluru",))
    response = client.get("/api/delivery/zones/match", params={"city": "bengaluru"})
    assert response.json()["zone"]["id"] == zone.id


def test_unserviceable_address_when_no_zone_matches(client, db):
    _zone(db)
    response = client.get(
        "/api/delivery/zones/match", params={"postal_code": "110001", "city": "Delhi"}
    )
    body = response.json()
    assert body["serviceable"] is False
    assert body["configured"] is True
    assert body["zone"] is None


def test_bootstrap_mode_without_zones_is_serviceable(client, db):
    """No zones configured: everything is serviceable (legacy flat fee)."""
    response = client.get(
        "/api/delivery/zones/match", params={"postal_code": "110001", "city": "Delhi"}
    )
    body = response.json()
    assert body["serviceable"] is True
    assert body["configured"] is False


# --------------------------------------------------------------------------
# Checkout blocks unserviceable addresses
# --------------------------------------------------------------------------
def test_checkout_blocks_unserviceable_address(client, customer, db, seed_catalog):
    _zone(db)  # covers 560* only
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    bad = {**ADDRESS, "postal_code": "110001", "city": "Delhi"}
    response = client.post("/api/checkout", json={"address": bad}, headers=headers)
    assert response.status_code == 400
    assert "deliver to this address" in response.json()["error"]["message"]


def test_checkout_works_in_bootstrap_mode(client, customer, db, seed_catalog):
    """No zones at all: checkout still works with the legacy flat fee."""

    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    response = client.post(
        "/api/checkout", json={"address": ADDRESS, "payment_method": "cod"}, headers=headers
    )
    assert response.status_code == 201, response.text
    order = response.json()
    # 180 subtotal, below the legacy 999 threshold -> 40 delivery.
    assert order["delivery_fee"] == 40
    assert order["total"] == 220


# --------------------------------------------------------------------------
# Zone pricing through checkout + summary
# --------------------------------------------------------------------------
def test_checkout_uses_zone_base_fee(client, customer, db, seed_catalog):
    _zone(db, base="60", express="150", free_over="999")
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    response = client.post(
        "/api/checkout", json={"address": ADDRESS, "payment_method": "cod"}, headers=headers
    )
    assert response.status_code == 201, response.text
    assert response.json()["delivery_fee"] == 60


def test_zone_free_delivery_threshold(client, customer, db, seed_catalog):
    _zone(db, base="60", express="150", free_over="150")
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    response = client.post(
        "/api/checkout", json={"address": ADDRESS, "payment_method": "cod"}, headers=headers
    )
    assert response.status_code == 201, response.text
    # 180 subtotal >= 150 threshold -> free delivery.
    assert response.json()["delivery_fee"] == 0


def test_express_fee_applies(client, customer, db, seed_catalog):
    _zone(db, base="40", express="120", free_over="9999")
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    response = client.post(
        "/api/checkout",
        json={"address": ADDRESS, "payment_method": "cod", "delivery_method": "express"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["delivery_method"] == "express"
    assert response.json()["delivery_fee"] == 120


def test_freeship_coupon_waives_zone_fee(client, customer, db, seed_catalog):
    from app.modules.discounts.models import Coupon, CouponKind

    _zone(db, base="60", express="150", free_over="99999")
    db.add(
        Coupon(
            code="FREESHIP",
            kind=CouponKind.FREE_DELIVERY,
            value=Decimal("0"),
            min_subtotal=Decimal("100"),
            is_active=True,
        )
    )
    db.commit()

    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    client.post("/api/cart/coupon", json={"code": "FREESHIP"}, headers=headers)
    response = client.post(
        "/api/checkout", json={"address": ADDRESS, "payment_method": "cod"}, headers=headers
    )
    assert response.status_code == 201, response.text
    assert response.json()["delivery_fee"] == 0


def test_checkout_summary_reflects_zone_fee(client, customer, db, seed_catalog):
    _zone(db, base="75", express="150", free_over="999")
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    response = client.get(
        "/api/checkout/summary",
        params={"postal_code": "560001", "city": "Bengaluru", "delivery_method": "standard"},
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["serviceable"] is True
    assert body["delivery_fee"] == 75
    assert body["delivery_zone"]["name"] == "Bengaluru Metro"


def test_checkout_summary_flags_unserviceable(client, customer, db, seed_catalog):
    _zone(db)
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    response = client.get(
        "/api/checkout/summary",
        params={"postal_code": "110001", "city": "Delhi"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["serviceable"] is False


# --------------------------------------------------------------------------
# Slot listing states
# --------------------------------------------------------------------------
def test_slot_states_available_limited_full(client, db):
    zone = _zone(db)
    _future_slot(db, zone.id, capacity=5, booked=0)   # available
    _future_slot(db, zone.id, start=time(13, 0), end=time(15, 0), capacity=5, booked=4)  # limited
    _future_slot(db, zone.id, start=time(16, 0), end=time(18, 0), capacity=5, booked=5)  # full

    response = client.get("/api/delivery/slots", params={"zone_id": zone.id})
    assert response.status_code == 200
    states = {s["start"]: s["state"] for s in response.json()}
    assert states["09:00:00"] == "available"
    assert states["13:00:00"] == "limited"
    assert states["16:00:00"] == "full"


def test_slot_inside_cutoff_is_closed_and_unbookable(client, db):
    import pytest

    from app.core.config import settings
    from app.core.exceptions import ConflictError
    from app.modules.delivery import service as delivery_service
    from app.modules.delivery.models import DeliverySlot

    zone = _zone(db)
    # Slot starting inside the cutoff window.
    soon = datetime.now(UTC) + timedelta(hours=settings.delivery_slot_cutoff_hours - 1)
    slot = DeliverySlot(
        zone_id=zone.id,
        slot_date=soon.date(),
        start_time=soon.time().replace(tzinfo=None, microsecond=0),
        end_time=(soon + timedelta(hours=2)).time().replace(tzinfo=None, microsecond=0),
        capacity=5,
        booked_count=0,
    )
    db.add(slot)
    db.commit()

    response = client.get("/api/delivery/slots", params={"zone_id": zone.id})
    matching = [s for s in response.json() if s["id"] == slot.id]
    assert matching and matching[0]["state"] == "closed"

    # Booking inside the cutoff must fail.
    with pytest.raises(ConflictError):
        delivery_service.book_slot(db, slot.id)


def test_blocked_date_hides_slots(client, db):
    import pytest

    from app.core.exceptions import ConflictError
    from app.modules.delivery import service as delivery_service
    from app.modules.delivery.models import DeliveryBlockedDate

    zone = _zone(db)
    slot = _future_slot(db, zone.id)
    db.add(
        DeliveryBlockedDate(zone_id=zone.id, blocked_date=slot.slot_date, reason="Holiday")
    )
    db.commit()

    response = client.get(
        "/api/delivery/slots",
        params={"zone_id": zone.id, "date_from": slot.slot_date.isoformat()},
    )
    assert response.json() == []

    # And the booking path rejects it too.
    with pytest.raises(ConflictError):
        delivery_service.book_slot(db, slot.id)


# --------------------------------------------------------------------------
# Scheduled checkout
# --------------------------------------------------------------------------
def test_scheduled_checkout_requires_slot(client, customer, db, seed_catalog):
    _zone(db)
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    response = client.post(
        "/api/checkout",
        json={"address": ADDRESS, "payment_method": "cod", "delivery_method": "scheduled"},
        headers=headers,
    )
    assert response.status_code == 400
    assert "time slot" in response.json()["error"]["message"]


def test_scheduled_checkout_books_slot_and_shows_window(client, customer, db, seed_catalog):
    from app.modules.delivery.models import DeliverySlot

    zone = _zone(db)
    slot = _future_slot(db, zone.id, capacity=3, booked=0)
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    response = client.post(
        "/api/checkout",
        json={
            "address": ADDRESS,
            "payment_method": "cod",
            "delivery_method": "scheduled",
            "slot_id": slot.id,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["delivery_method"] == "scheduled"
    assert body["delivery_slot"]["id"] == slot.id
    assert body["delivery_slot"]["slot_date"] == slot.slot_date.isoformat()

    db.expire_all()
    assert db.get(DeliverySlot, slot.id).booked_count == 1


def test_slot_from_other_zone_rejected(client, customer, db, seed_catalog):
    _zone(db, name="Zone A", postal=("560",), cities=("Bengaluru",))
    other = _zone(db, name="Zone B", postal=("561",), cities=())
    slot = _future_slot(db, other.id)
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    response = client.post(
        "/api/checkout",
        json={
            "address": ADDRESS,  # matches Zone A (560*)
            "payment_method": "cod",
            "delivery_method": "scheduled",
            "slot_id": slot.id,  # ...but the slot belongs to Zone B
        },
        headers=headers,
    )
    assert response.status_code == 400


# --------------------------------------------------------------------------
# The race: two checkouts, one remaining seat
# --------------------------------------------------------------------------
def test_slot_capacity_race_one_wins(client, db, seed_catalog):
    """Two customers race for the last seat of a slot: exactly one succeeds."""
    from app.modules.delivery.models import DeliverySlot
    from app.modules.orders.models import Order

    zone = _zone(db)
    slot = _future_slot(db, zone.id, capacity=1, booked=0)

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
            add = racer.post(
                "/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers
            )
            assert add.status_code == 201, add.text
            ready.wait(timeout=30)
            response = racer.post(
                "/api/checkout",
                json={
                    "address": ADDRESS,
                    "payment_method": "cod",
                    "delivery_method": "scheduled",
                    "slot_id": slot.id,
                },
                headers=headers,
            )
            with lock:
                results.append(response)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(race, ["slotracer1@test.dev", "slotracer2@test.dev"]))

    codes = sorted(r.status_code for r in results)
    assert codes == [201, 409], [r.status_code for r in results]

    db.expire_all()
    assert db.get(DeliverySlot, slot.id).booked_count == 1
    assert db.query(Order).filter(Order.status != "cancelled").count() == 1


# --------------------------------------------------------------------------
# Cancellation frees the slot
# --------------------------------------------------------------------------
def test_cancel_frees_slot(client, customer, db, seed_catalog):
    from app.modules.delivery.models import DeliverySlot

    zone = _zone(db)
    slot = _future_slot(db, zone.id, capacity=2, booked=0)
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    placed = client.post(
        "/api/checkout",
        json={
            "address": ADDRESS,
            "payment_method": "cod",
            "delivery_method": "scheduled",
            "slot_id": slot.id,
        },
        headers=headers,
    )
    assert placed.status_code == 201, placed.text
    order_id = placed.json()["id"]

    cancelled = client.post(f"/api/orders/{order_id}/cancel", headers=headers)
    assert cancelled.status_code == 200, cancelled.text

    db.expire_all()
    assert db.get(DeliverySlot, slot.id).booked_count == 0


def test_payment_timeout_sweeper_frees_slot(db, seed_catalog):
    """The sweeper cancels an unpaid online order: its slot seat is freed."""
    from sqlalchemy import update

    from app.core.security import hash_password
    from app.modules.cart.models import Cart, CartItem
    from app.modules.delivery.models import DeliverySlot
    from app.modules.inventory.models import StockReservation
    from app.modules.orders import tasks as order_tasks
    from app.modules.orders.models import Order, OrderStatus
    from app.modules.users.models import User, UserRole

    user = User(
        email="sweep@slot.test",
        full_name="Sweep",
        password_hash=hash_password(PASSWORD),
        role=UserRole.CUSTOMER,
    )
    db.add(user)
    db.flush()

    zone = _zone(db)
    slot = _future_slot(db, zone.id, capacity=2, booked=0)

    cart = Cart(user_id=user.id)
    db.add(cart)
    db.flush()
    db.add(CartItem(cart_id=cart.id, variant_id=seed_catalog["large"].id, quantity=1))
    db.flush()

    from app.modules.orders import service as orders_service
    from app.modules.orders.schemas import AddressIn, CheckoutIn

    payload = CheckoutIn(
        payment_method="zarinpal",
        address=AddressIn(**ADDRESS),
        delivery_method="scheduled",
        slot_id=slot.id,
    )
    placed = orders_service.checkout(db, user, cart, payload)
    assert placed.delivery_slot_id == slot.id

    db.expire_all()
    assert db.get(DeliverySlot, slot.id).booked_count == 1

    # Age the stock reservations into the past, then sweep (the sweeper keys
    # off StockReservation.expires_at, not the order's deadline column).
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
    swept = db.get(Order, placed.id)
    assert swept.status == OrderStatus.CANCELLED
    assert db.get(DeliverySlot, slot.id).booked_count == 0


# --------------------------------------------------------------------------
# Admin: zones CRUD, templates, generation, blocking, board
# --------------------------------------------------------------------------
def _staff_headers(client, admin_user):
    return login(client, admin_user)


def test_admin_zone_crud(client, db, admin_user):
    headers = _staff_headers(client, admin_user)

    created = client.post(
        api := "/api/admin/delivery/zones",
        json={
            "name": "Pune City",
            "postal_codes": ["411"],
            "cities": ["Pune"],
            "base_fee": 50,
            "express_fee": 120,
            "free_delivery_threshold": 1500,
            "is_active": True,
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    zone_id = created.json()["id"]

    listed = client.get(api, headers=headers)
    assert listed.status_code == 200
    page = listed.json()
    assert page["total"] == 1
    assert page["items"][0]["name"] == "Pune City"

    patched = client.patch(
        f"{api}/{zone_id}",
        json={
            "name": "Pune Metro",
            "postal_codes": ["411", "412"],
            "cities": ["Pune"],
            "base_fee": 55,
            "express_fee": 130,
            "free_delivery_threshold": 1500,
            "is_active": False,
        },
        headers=headers,
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "Pune Metro"
    assert patched.json()["is_active"] is False

    deleted = client.delete(f"{api}/{zone_id}", headers=headers)
    assert deleted.status_code == 204


def test_admin_express_cannot_be_cheaper_than_base(client, db, admin_user):
    headers = _staff_headers(client, admin_user)
    response = client.post(
        "/api/admin/delivery/zones",
        json={
            "name": "Bad Zone",
            "postal_codes": [],
            "cities": ["X"],
            "base_fee": 100,
            "express_fee": 50,
            "is_active": True,
        },
        headers=headers,
    )
    assert response.status_code == 422


def test_admin_template_generate_and_block_date(client, db, admin_user):
    from datetime import date as date_type

    headers = _staff_headers(client, admin_user)
    zone = _zone(db)

    created = client.post(
        f"/api/admin/delivery/zones/{zone.id}/templates",
        json={"weekday": 2, "start_time": "09:00", "end_time": "12:00", "capacity": 8},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    template_id = created.json()["id"]

    # Duplicate window -> 409.
    duplicate = client.post(
        f"/api/admin/delivery/zones/{zone.id}/templates",
        json={"weekday": 2, "start_time": "09:00", "end_time": "12:00", "capacity": 8},
        headers=headers,
    )
    assert duplicate.status_code == 409

    # Generate 14 days from today.
    today = date_type.today().isoformat()
    generated = client.post(
        f"/api/admin/delivery/zones/{zone.id}/generate",
        json={"date_from": today, "days": 14},
        headers=headers,
    )
    assert generated.status_code == 200
    # Idempotent: a second run creates nothing new.
    again = client.post(
        f"/api/admin/delivery/zones/{zone.id}/generate",
        json={"date_from": today, "days": 14},
        headers=headers,
    )
    assert again.json()["created"] == 0

    slots = client.get(
        f"/api/admin/delivery/zones/{zone.id}/slots", headers=headers
    ).json()
    assert slots["total"] == generated.json()["created"]

    # Block a specific date that has slots.
    target = next(
        s for s in client.get(
            "/api/delivery/slots", params={"zone_id": zone.id}
        ).json()
    )
    blocked = client.post(
        f"/api/admin/delivery/zones/{zone.id}/blocked-dates",
        json={"date": target["date"], "reason": "Public holiday"},
        headers=headers,
    )
    assert blocked.status_code == 201

    # Slots on the blocked date vanish from the public grid.
    public = client.get(
        "/api/delivery/slots",
        params={"zone_id": zone.id, "date_from": target["date"]},
    ).json()
    assert all(s["date"] != target["date"] for s in public)

    # Unblock brings them back.
    unblocked = client.post(
        f"/api/admin/delivery/zones/{zone.id}/unblock-date",
        json={"date": target["date"]},
        headers=headers,
    )
    assert unblocked.status_code == 204
    public = client.get(
        "/api/delivery/slots",
        params={"zone_id": zone.id, "date_from": target["date"]},
    ).json()
    assert any(s["date"] == target["date"] for s in public)

    # Template delete.
    deleted = client.delete(
        f"/api/admin/delivery/templates/{template_id}", headers=headers
    )
    assert deleted.status_code == 204


def test_admin_requires_staff(client, db, customer):
    headers = login(client, customer)
    response = client.get("/api/admin/delivery/zones", headers=headers)
    assert response.status_code == 403
