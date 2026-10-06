import threading
from concurrent.futures import ThreadPoolExecutor

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


def test_guest_cart_and_login_merge(client, customer, seed_catalog):
    added = client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1})
    assert added.status_code == 201, added.text
    assert added.json()["item_count"] == 1

    headers = login(client, customer)
    cart = client.get("/api/cart", headers=headers).json()
    assert cart["item_count"] == 1, "guest cart must follow the account after login"

    patched = client.patch(
        f"/api/cart/items/{cart['items'][0]['id']}", json={"quantity": 2}, headers=headers
    )
    assert patched.status_code == 200
    assert patched.json()["items"][0]["quantity"] == 2


def test_login_merges_guest_cart_into_existing_account_cart(client, customer, seed_catalog):
    # First sign-in: the account gets its own (empty) cart.
    headers = login(client, customer)
    assert client.get("/api/cart", headers=headers).json()["item_count"] == 0
    owned = client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    assert owned.status_code == 201, owned.text

    # Fresh guest session shopping while the account already owns a cart.
    client.post("/api/auth/logout")
    client.cookies.clear()
    assert client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}).status_code == 201
    assert client.post("/api/cart/items", json={"variant_id": 1, "quantity": 1}).status_code == 201

    # Second sign-in takes the merge branch: guest rows move onto the account cart.
    headers = login(client, customer)
    cart = client.get("/api/cart", headers=headers).json()
    assert cart["item_count"] == 3, cart
    assert {i["variant_id"]: i["quantity"] for i in cart["items"]} == {2: 2, 1: 1}

    summary = client.get("/api/checkout/summary", headers=headers)
    assert summary.status_code == 200, summary.text
    assert summary.json()["item_count"] == 3


def test_cart_stock_guard(client, seed_catalog):
    assert client.post("/api/cart/items", json={"variant_id": 1, "quantity": 2}).status_code == 409
    assert client.post("/api/cart/items", json={"variant_id": 1, "quantity": 1}).status_code == 201


def test_checkout_creates_order_and_decrements_stock(client, db, customer, seed_catalog):
    from app.modules.inventory.models import Inventory

    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)

    summary = client.get("/api/checkout/summary", headers=headers).json()
    assert summary["subtotal"] == 540
    assert summary["delivery_fee"] == 40  # free delivery starts at 999
    assert [m["code"] for m in summary["payment_methods"]] == ["cod"]

    response = client.post(
        "/api/checkout",
        json={"address": ADDRESS, "payment_method": "cod", "note": "Leave at the gate"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["order_number"].startswith("OM-")
    assert order["status"] == "pending"
    assert order["payment_method"] == "cod"
    assert order["payment_status"] == "pending"
    assert order["total"] == 580
    assert len(order["items"]) == 1
    assert [h["status"] for h in order["history"]] == ["pending"]

    # stock decremented in the very same transaction as the order insert
    db.expire_all()
    assert db.get(Inventory, 2).quantity == 7

    assert client.get("/api/cart", headers=headers).json()["items"] == []

    history = client.get("/api/orders", headers=headers).json()
    assert history["total"] == 1
    assert history["items"][0]["order_number"] == order["order_number"]

    detail = client.get(f"/api/orders/{order['id']}", headers=headers).json()
    assert detail["customer_note"] == "Leave at the gate"
    assert detail["subtotal"] == 540


def test_checkout_rejects_empty_cart(client, customer, seed_catalog):
    headers = login(client, customer)
    response = client.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
    assert response.status_code == 400


def test_concurrent_checkout_only_one_wins(client, db, seed_catalog):
    """Two customers race for the last unit: exactly one order is created."""
    from app.modules.inventory.models import Inventory
    from app.modules.orders.models import Order

    db.expire_all()
    assert db.get(Inventory, 1).quantity == 1

    lock = threading.Lock()
    results = []
    # Both carts must be filled before either checkout starts, otherwise one
    # racer's add can land after the other's checkout has consumed the stock.
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
                "/api/cart/items", json={"variant_id": 1, "quantity": 1}, headers=headers
            )
            assert add.status_code == 201, add.text
            ready.wait(timeout=30)
            response = racer.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
            with lock:
                results.append(response)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(race, ["racer1@test.dev", "racer2@test.dev"]))

    codes = sorted(r.status_code for r in results)
    assert codes == [201, 409], [r.status_code for r in results]
    failing = next(r for r in results if r.status_code == 409)
    assert failing.json()["error"]["code"] == "conflict"

    db.expire_all()
    assert db.get(Inventory, 1).quantity == 0
    assert db.query(Order).filter(Order.status != "cancelled").count() == 1


def test_concurrent_checkout_of_the_same_cart_only_one_wins(client, db, customer, seed_catalog):
    """Double click / two tabs: one cart checked out twice at the same moment.

    Both requests see the cart, but the second blocks on the inventory locks the
    first one holds; after the first commits it must find the cart empty rather
    than build a duplicate order from its stale copy of the items.
    """
    from app.modules.orders.models import Order

    headers = login(client, customer)
    added = client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    assert added.status_code == 201, added.text

    ready = threading.Barrier(2)
    lock = threading.Lock()
    results = []

    def race() -> None:
        with TestClient(app=client.app, base_url="http://testserver") as racer:
            ready.wait(timeout=30)
            response = racer.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
            with lock:
                results.append(response)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: race(), range(2)))

    codes = sorted(r.status_code for r in results)
    assert codes == [201, 400], [r.status_code for r in results]
    loser = next(r for r in results if r.status_code == 400)
    assert loser.json()["error"]["message"] == "Your cart is empty"

    db.expire_all()
    assert db.query(Order).count() == 1, "one cart may only produce one order"
