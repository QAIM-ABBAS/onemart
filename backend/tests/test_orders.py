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


def _place_order(client, email: str, variant_id: int = 2, quantity: int = 3) -> dict:
    headers = login(client, email)
    client.post("/api/cart/items", json={"variant_id": variant_id, "quantity": quantity}, headers=headers)
    response = client.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json(), headers


def test_admin_order_list_filters_and_sorts(client, db, admin_user, customer, seed_catalog):
    admin_headers = login(client, admin_user)
    order, _ = _place_order(client, customer)

    page_one = client.get("/api/admin/orders", headers=admin_headers).json()
    assert page_one["total"] == 1
    assert page_one["items"][0]["order_number"] == order["order_number"]
    assert page_one["items"][0]["item_count"] == 3

    by_number = client.get(
        "/api/admin/orders", params={"q": order["order_number"]}, headers=admin_headers
    ).json()
    assert by_number["total"] == 1

    no_match = client.get("/api/admin/orders", params={"q": "ZZZZ"}, headers=admin_headers).json()
    assert no_match["total"] == 0

    pending = client.get(
        "/api/admin/orders", params={"status": "pending"}, headers=admin_headers
    ).json()
    assert pending["total"] == 1

    delivered = client.get(
        "/api/admin/orders", params={"status": "delivered"}, headers=admin_headers
    ).json()
    assert delivered["total"] == 0

    sorted_page = client.get(
        "/api/admin/orders", params={"sort": "total_desc"}, headers=admin_headers
    ).json()
    assert sorted_page["items"][0]["total"] == order["total"]


def test_status_timeline_walks_forward(client, db, admin_user, customer, seed_catalog):
    admin_headers = login(client, admin_user)
    order, customer_headers = _place_order(client, customer)

    # invalid jump: pending -> shipped
    bad = client.patch(
        f"/api/admin/orders/{order['id']}/status",
        json={"status": "shipped"},
        headers=admin_headers,
    )
    assert bad.status_code == 409

    for status in ["confirmed", "packed", "shipped", "delivered"]:
        response = client.patch(
            f"/api/admin/orders/{order['id']}/status",
            json={"status": status, "note": f"moved to {status}"},
            headers=admin_headers,
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == status

    final = client.get(f"/api/admin/orders/{order['id']}", headers=admin_headers).json()
    timeline = [h["status"] for h in final["history"]]
    assert timeline == ["pending", "confirmed", "packed", "shipped", "delivered"]
    # COD is captured when the order is delivered
    assert final["payment_status"] == "paid"

    customer_view = client.get(f"/api/orders/{order['id']}", headers=customer_headers).json()
    assert [h["status"] for h in customer_view["history"]] == timeline

    # terminal states cannot move
    assert (
        client.patch(
            f"/api/admin/orders/{order['id']}/status",
            json={"status": "cancelled"},
            headers=admin_headers,
        ).status_code
        == 409
    )


def test_cancel_restores_stock(client, db, admin_user, customer, seed_catalog):
    from app.modules.inventory.models import Inventory

    admin_headers = login(client, admin_user)
    order, _ = _place_order(client, customer, variant_id=2, quantity=4)

    db.expire_all()
    assert db.get(Inventory, 2).quantity == 6

    response = client.patch(
        f"/api/admin/orders/{order['id']}/status",
        json={"status": "cancelled", "note": "Customer request"},
        headers=admin_headers,
    )
    assert response.status_code == 200

    db.expire_all()
    assert db.get(Inventory, 2).quantity == 10
    assert response.json()["payment_status"] == "pending"


def test_customers_cannot_see_others_orders(client, customer, seed_catalog):
    order, _ = _place_order(client, customer)

    other = client.post(
        "/api/auth/register",
        json={"email": "intruder@test.dev", "password": PASSWORD, "full_name": "Intruder"},
    )
    assert other.status_code == 201, other.text
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    assert client.get(f"/api/orders/{order['id']}", headers=other_headers).status_code == 404
    assert client.get("/api/orders", headers=other_headers).json()["total"] == 0

    own_headers = login(client, customer)
    assert client.get(f"/api/orders/{order['id']}", headers=own_headers).status_code == 200


def test_order_history_is_append_only(db, customer, seed_catalog):
    import pytest
    from sqlalchemy import select

    from app.core.exceptions import AppError
    from app.modules.orders.models import Order, OrderStatus, OrderStatusHistory, PaymentStatus
    from app.modules.users.models import User

    user = db.scalar(select(User).where(User.email == customer))
    order = Order(
        order_number="OM-20260101-000001",
        user_id=user.id,
        status=OrderStatus.PENDING,
        payment_method="cod",
        payment_status=PaymentStatus.PENDING,
        recipient_name="Casey",
        phone="+91 1",
        line1="12 Test St",
        city="Bengaluru",
        state="Karnataka",
        postal_code="560001",
        subtotal=100,
        delivery_fee=40,
        total=140,
    )
    db.add(order)
    db.flush()
    entry = OrderStatusHistory(order_id=order.id, status=OrderStatus.PENDING, note="placed")
    db.add(entry)
    db.commit()

    entry.note = "tampered"
    with pytest.raises(AppError):
        db.flush()
    db.rollback()

    db.delete(entry)
    with pytest.raises(AppError):
        db.flush()
    db.rollback()


def test_transition_rules_reject_jumps(client, db, admin_user, customer, seed_catalog):
    """The map is enforced server-side: no skipping ahead, no stepping back."""
    admin_headers = login(client, admin_user)
    order, _ = _place_order(client, customer)

    # The jump the rules exist to prevent: pending straight to delivered.
    bad = client.patch(
        f"/api/admin/orders/{order['id']}/status",
        json={"status": "delivered"},
        headers=admin_headers,
    )
    assert bad.status_code == 409
    assert bad.json()["error"]["details"]["allowed"] == ["cancelled", "confirmed"]

    # A legal move records exactly one history row...
    ok = client.patch(
        f"/api/admin/orders/{order['id']}/status",
        json={"status": "confirmed", "note": "phone confirmed"},
        headers=admin_headers,
    )
    assert ok.status_code == 200, ok.text

    # ...and a backwards one records none.
    back = client.patch(
        f"/api/admin/orders/{order['id']}/status",
        json={"status": "pending"},
        headers=admin_headers,
    )
    assert back.status_code == 409

    detail = client.get(f"/api/admin/orders/{order['id']}", headers=admin_headers).json()
    assert [h["status"] for h in detail["history"]] == ["pending", "confirmed"]


def test_customer_cancels_pending_order_and_stock_returns(client, db, customer, seed_catalog):
    from sqlalchemy import func, select

    from app.modules.audit.models import AuditLog
    from app.modules.inventory.models import Inventory

    order, headers = _place_order(client, customer, variant_id=2, quantity=4)

    db.expire_all()
    assert db.get(Inventory, 2).quantity == 6

    response = client.post(f"/api/orders/{order['id']}/cancel", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "cancelled"
    assert [h["status"] for h in body["history"]] == ["pending", "cancelled"]
    assert body["history"][-1]["note"] == "Cancelled by the customer"

    # Stock is restored in the same transaction that wrote the history row.
    db.expire_all()
    assert db.get(Inventory, 2).quantity == 10

    # Self-service is not an admin action: the history row is the record.
    audited = db.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.entity == "order")
    )
    assert audited == 0


def test_customer_cancel_window_closes_once_packed(client, db, admin_user, customer, seed_catalog):
    admin_headers = login(client, admin_user)

    # Confirmed: still the customer's call.
    order, headers = _place_order(client, customer)
    confirmed = client.patch(
        f"/api/admin/orders/{order['id']}/status",
        json={"status": "confirmed"},
        headers=admin_headers,
    )
    assert confirmed.status_code == 200
    cancelled = client.post(f"/api/orders/{order['id']}/cancel", headers=headers)
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"

    # Packed: the window has closed for the customer.
    other, other_headers = _place_order(client, customer)
    for status in ("confirmed", "packed"):
        moved = client.patch(
            f"/api/admin/orders/{other['id']}/status",
            json={"status": status},
            headers=admin_headers,
        )
        assert moved.status_code == 200, moved.text

    late = client.post(f"/api/orders/{other['id']}/cancel", headers=other_headers)
    assert late.status_code == 409
    assert late.json()["error"]["details"]["allowed"] == ["confirmed", "pending"]

    # Delivered/Cancelled are terminal for everyone.
    for status in ("shipped", "delivered"):
        moved = client.patch(
            f"/api/admin/orders/{other['id']}/status",
            json={"status": status},
            headers=admin_headers,
        )
        assert moved.status_code == 200, moved.text
    terminal = client.post(f"/api/orders/{other['id']}/cancel", headers=other_headers)
    assert terminal.status_code == 409


def test_customer_cannot_cancel_someone_elses_order(client, customer, seed_catalog):
    order, headers = _place_order(client, customer)

    other = client.post(
        "/api/auth/register",
        json={"email": "nosy@test.dev", "password": PASSWORD, "full_name": "Nosy Parker"},
    )
    assert other.status_code == 201, other.text
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    assert (
        client.post(f"/api/orders/{order['id']}/cancel", headers=other_headers).status_code
        == 404
    )
    # Still pending for its owner.
    detail = client.get(f"/api/orders/{order['id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["status"] == "pending"


def test_admin_status_change_is_audited(client, db, admin_user, customer, seed_catalog):
    from sqlalchemy import select

    from app.modules.audit.models import AuditLog

    admin_headers = login(client, admin_user)
    order, _ = _place_order(client, customer)

    changed = client.patch(
        f"/api/admin/orders/{order['id']}/status",
        json={"status": "confirmed", "note": "called the customer"},
        headers=admin_headers,
    )
    assert changed.status_code == 200, changed.text

    db.expire_all()
    entry = db.scalar(select(AuditLog).where(AuditLog.entity == "order"))
    assert entry is not None
    assert entry.action == "order.status_change"
    assert entry.entity_id == order["id"]
    assert entry.actor_id is not None
    assert entry.detail == {
        "from": "pending",
        "to": "confirmed",
        "note": "called the customer",
    }
