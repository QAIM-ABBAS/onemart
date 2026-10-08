"""Phase 1: stock reservation + online payment (Zarinpal, mock mode).

Covers the contracts the whole flow rests on:

* an online checkout **holds** stock (reserved) instead of taking it, and the
  hold is what product/cart/checkout availability is measured against;
* the callback is the only place an order becomes paid — it is idempotent, the
  verdict comes from a server-side verify with **our** amount, and the redirect's
  own parameters are never trusted;
* an abandoned payment expires: the sweeper releases the hold, cancels the
  order with a "payment timeout" history row and tells the customer — twice;
* money that moved can be refunded (full / partial / manual) and refunds are
  refused where they do not belong.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.config import settings
from app.modules.inventory.models import Inventory, ReservationStatus, StockReservation
from app.modules.notifications.models import Notification
from app.modules.orders.models import Order, OrderStatus, PaymentStatus
from app.modules.orders.tasks import sweep_expired_reservations
from app.modules.payments import zarinpal
from app.modules.payments.models import Payment, PaymentAttemptStatus
from tests.conftest import login

ADDRESS = {
    "full_name": "Casey Customer",
    "phone": "+91 98765 43210",
    "line1": "12, Test Street",
    "city": "Bengaluru",
    "state": "Karnataka",
    "postal_code": "560001",
    "country": "IN",
}


def _place_online_order(client, email: str, variant_id: int = 2, quantity: int = 3):
    """Checkout with the online provider (no attempt opened yet beyond the one
    checkout writes) — returns (order, customer headers)."""
    headers = login(client, email)
    added = client.post(
        "/api/cart/items", json={"variant_id": variant_id, "quantity": quantity},
        headers=headers,
    )
    assert added.status_code == 201, added.text
    response = client.post(
        "/api/checkout",
        json={"address": ADDRESS, "payment_method": "zarinpal"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json(), headers


def _initiate(client, headers, order_id: int) -> tuple[dict, str]:
    """Open an attempt; returns (payload, authority)."""
    response = client.post(f"/api/orders/{order_id}/payments", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    authority = payload["redirect_url"].rsplit("/", 1)[-1]
    return payload, authority


def _drive_gateway(client, authority: str, result: str = "ok", **extra_query) -> str:
    """Click Complete/Failure on the mock StartPay page, then follow the
    gateway's redirect back to our callback (host swapped for the test host,
    because the configured public URL points at the dev servers).

    Returns the Location of the final redirect — the SPA result page — whose
    ``status`` hint the frontend is allowed to display but never to trust.
    """
    params = {"result": result, **extra_query}
    page = client.get(
        f"/api/payments/mock/{authority}", params=params, follow_redirects=False
    )
    assert page.status_code == 302, page.text
    # Absolute URL built from API_PUBLIC_URL; re-issue it against the test host.
    location = page.headers["location"]
    query = location.split("?", 1)[1]
    callback = client.get(f"/api/payments/callback?{query}", follow_redirects=False)
    assert callback.status_code == 302, callback.text
    return callback.headers["location"]


def _payment_status(client, headers, payment_id: int) -> dict:
    response = client.get(f"/api/payments/{payment_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _user_id(db, email: str) -> int:
    from app.modules.users.models import User

    return db.scalar(select(User.id).where(User.email == email))


def test_online_checkout_holds_stock_instead_of_taking_it(
    client, db, customer, seed_catalog
):
    order, headers = _place_online_order(client, customer)

    assert order["status"] == "pending"
    assert order["payment_status"] == "pending"
    assert order["payment_method"] == "zarinpal"
    assert order["payment_deadline"] is not None
    assert len(order["payments"]) == 1
    assert order["payments"][0]["status"] == "initiated"

    db.expire_all()
    inventory = db.get(Inventory, 2)
    assert inventory.quantity == 10, "nothing left the shelf yet"
    assert inventory.reserved == 3
    assert inventory.available == 7

    reservation = db.scalar(
        select(StockReservation).where(StockReservation.order_id == order["id"])
    )
    assert reservation.status == ReservationStatus.ACTIVE
    assert reservation.qty == 3

    # ...and that hold is what every availability read is measured against.
    denied = client.post(
        "/api/cart/items", json={"variant_id": 2, "quantity": 8}, headers=headers
    )
    assert denied.status_code == 409
    allowed = client.post(
        "/api/cart/items", json={"variant_id": 2, "quantity": 7}, headers=headers
    )
    assert allowed.status_code == 201, allowed.text


def test_gateway_happy_path_confirms_order_and_consumes_stock(
    client, db, customer, seed_catalog
):

    order, headers = _place_online_order(client, customer)
    started, authority = _initiate(client, headers, order["id"])
    assert started["amount"] == order["total"]
    assert started["status"] == "pending"

    # The local StartPay page renders before a decision is made.
    page = client.get(f"/api/payments/mock/{authority}")
    assert page.status_code == 200
    assert authority in page.text

    landing = _drive_gateway(client, authority, "ok")
    assert "payment/result" in landing
    assert "status=paid" in landing

    status = _payment_status(client, headers, started["payment_id"])
    assert status["status"] == "paid"
    assert status["order_status"] == "confirmed"
    assert status["already_processed"] is False

    db.expire_all()
    order_row = db.get(Order, order["id"])
    assert order_row.status == OrderStatus.CONFIRMED
    assert order_row.payment_status == PaymentStatus.PAID

    inventory = db.get(Inventory, 2)
    assert inventory.quantity == 7, "payment converts the hold into a sale"
    assert inventory.reserved == 0
    assert inventory.available == 7

    reservation = db.scalar(
        select(StockReservation).where(StockReservation.order_id == order["id"])
    )
    assert reservation.status == ReservationStatus.CONSUMED

    history = client.get(f"/api/orders/{order['id']}", headers=headers).json()
    assert [h["status"] for h in history["history"]] == ["pending", "confirmed"]

    rows = list(
        db.scalars(
            select(Notification).where(Notification.user_id == _user_id(db, customer))
        ).all()
    )
    assert any("confirmed" in (r.body or "") for r in rows)


def test_callback_is_idempotent(client, db, customer, seed_catalog):
    order, headers = _place_online_order(client, customer)
    started, authority = _initiate(client, headers, order["id"])

    first = _drive_gateway(client, authority, "ok")
    assert "status=paid" in first
    # The gateway (or a refreshed tab) delivers the same return again: the
    # webhook twin answers with the outcome it refuses to re-apply.
    second = _drive_gateway(client, authority, "ok")
    assert "status=paid" in second
    replay = client.post(
        "/api/payments/webhook",
        json={"payment_id": started["payment_id"], "authority": authority, "status": "OK"},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["status"] == "paid"
    assert replay.json()["already_processed"] is True, "a replay is reported, not re-applied"

    db.expire_all()
    inventory = db.get(Inventory, 2)
    assert inventory.quantity == 7, "the stock movement happened exactly once"
    assert inventory.reserved == 0

    history = client.get(f"/api/orders/{order['id']}", headers=headers).json()
    assert [h["status"] for h in history["history"]] == ["pending", "confirmed"], (
        "no duplicate confirmation row"
    )


def test_amount_tampering_is_never_marked_paid(client, db, customer, seed_catalog):
    """The amount is verified from *our* database: a gateway record for a
    different charge can only produce a failure, never a paid order."""
    order, headers = _place_online_order(client, customer)
    started, authority = _initiate(client, headers, order["id"])

    record = zarinpal.mock_record(authority)
    assert record is not None
    record["charged"] = "1.00"  # the gateway says a different amount moved
    zarinpal._mock_put(authority, record)

    # The redirect can shout Status=OK all it likes.
    landing = _drive_gateway(client, authority, "ok")
    assert "status=failed" in landing

    status = _payment_status(client, headers, started["payment_id"])
    assert status["status"] == "failed"
    assert status["order_status"] == "pending"

    db.expire_all()
    assert db.get(Order, order["id"]).payment_status == PaymentStatus.FAILED
    inventory = db.get(Inventory, 2)
    assert inventory.quantity == 10, "stock is still held, not consumed"
    assert inventory.reserved == 3

    payment = db.get(Payment, started["payment_id"])
    assert payment.raw_response.get("verify_code") == "amount_mismatch"


def test_unknown_amount_query_param_is_ignored(client, db, customer, seed_catalog):
    """No amount ever travels in the redirect: our row is the only source."""
    order, headers = _place_online_order(client, customer)
    started, authority = _initiate(client, headers, order["id"])

    page = client.get(
        f"/api/payments/mock/{authority}",
        params={"result": "ok", "Amount": "1", "amount": "1"},
        follow_redirects=False,
    )
    query = page.headers["location"].split("?", 1)[1]
    query += "&amount=1"
    callback = client.get(f"/api/payments/callback?{query}", follow_redirects=False)
    assert "status=paid" in callback.headers["location"]

    status = _payment_status(client, headers, started["payment_id"])
    assert status["amount"] == order["total"], "the DB amount is what gets reported"

    db.expire_all()
    assert db.get(Inventory, 2).quantity == 7


def test_foreign_authority_changes_nothing(client, db, customer, seed_catalog):
    """A callback carrying someone else's reference is rejected outright —
    the order stays unpaid until *its own* reference comes back."""
    order, headers = _place_online_order(client, customer)
    started, authority = _initiate(client, headers, order["id"])

    spoofed = client.get(
        "/api/payments/callback",
        params={
            "payment_id": started["payment_id"],
            "Authority": "MOCKSOMEONEELSESREFERENCE",
            "Status": "OK",
        },
        follow_redirects=False,
    )
    assert spoofed.status_code == 302
    assert "status=failed" in spoofed.headers["location"]

    status = _payment_status(client, headers, started["payment_id"])
    assert status["status"] == "pending"
    assert status["order_status"] == "pending"
    db.expire_all()
    inventory = db.get(Inventory, 2)
    assert inventory.quantity == 10, "nothing moved"
    assert inventory.reserved == 3

    # The genuine reference still settles it afterwards.
    landing = _drive_gateway(client, authority, "ok")
    assert "status=paid" in landing
    db.expire_all()
    assert db.get(Order, order["id"]).payment_status == PaymentStatus.PAID
    assert db.get(Inventory, 2).quantity == 7


def _initiate_with_origin(client, headers, order_id: int, origin: str) -> str:
    """Open an attempt the way the SPA does — from a specific browser host."""
    response = client.post(
        f"/api/orders/{order_id}/payments",
        headers={**headers, "Origin": origin},
    )
    assert response.status_code == 200, response.text
    return response.json()["redirect_url"].rsplit("/", 1)[-1]


def test_return_redirect_lands_on_the_origin_the_customer_came_from(
    client, db, customer, seed_catalog
):
    """The gateway bounce must bring the customer back to *their* host: a dev
    server on 127.0.0.1 keeps the session cookie it set, instead of landing on
    localhost where the result page would poll signed-out and look broken."""
    order, headers = _place_online_order(client, customer)
    authority = _initiate_with_origin(
        client, headers, order["id"], "http://127.0.0.1:5173"
    )

    landing = _drive_gateway(client, authority, "ok")
    assert landing.startswith("http://127.0.0.1:5173/payment/result?")
    assert f"payment_id={order['payments'][0]['id']}" in landing
    assert "status=paid" in landing

    status = _payment_status(client, headers, order["payments"][0]["id"])
    assert status["status"] == "paid", "the honoured origin changes nothing else"


def test_return_redirect_never_trusts_an_unknown_origin(
    client, db, customer, seed_catalog
):
    """Only the configured SPA origins qualify as a return target — this is an
    open-redirect guard, checked both when the header claims one and when a
    tampered attempt row stores one."""
    # An Origin header the allowlist doesn't know is dropped at initiate time.
    order, headers = _place_online_order(client, customer)
    authority = _initiate_with_origin(
        client, headers, order["id"], "https://evil.example"
    )
    landing = _drive_gateway(client, authority, "ok")
    assert landing.startswith(f"{settings.public_base_url}/payment/result?")
    assert "status=paid" in landing

    # ...and a foreign origin smuggled into the stored attempt afterwards is
    # re-validated on the way out and still falls back to the configured base.
    second, headers = _place_online_order(client, customer)
    _, second_authority = _initiate(client, headers, second["id"])
    payment = db.get(Payment, second["payments"][0]["id"])
    payment.raw_response = {
        **(payment.raw_response or {}),
        "return_origin": "https://evil.example",
    }
    db.commit()

    landing = _drive_gateway(client, second_authority, "ok")
    assert landing.startswith(f"{settings.public_base_url}/payment/result?")
    assert "status=paid" in landing


def test_gateway_failure_keeps_order_pending_and_allows_retry(
    client, db, customer, seed_catalog, monkeypatch
):
    from app.core.exceptions import AppError
    from app.modules.orders.payment import payment_registry

    order, headers = _place_online_order(client, customer)

    provider = payment_registry.get("zarinpal")

    def unreachable(*args, **kwargs):
        raise AppError("The payment gateway is unreachable right now")

    monkeypatch.setattr(provider, "start_payment", unreachable)
    failed = client.post(f"/api/orders/{order['id']}/payments", headers=headers)
    assert failed.status_code == 400, failed.text

    db.expire_all()
    order_row = db.get(Order, order["id"])
    assert order_row.status == OrderStatus.PENDING, "a gateway outage is not a cancellation"
    assert order_row.payment_status == PaymentStatus.PENDING
    attempt = db.scalar(
        select(Payment)
        .where(Payment.order_id == order["id"])
        .order_by(Payment.id.desc())
    )
    assert attempt.status == PaymentAttemptStatus.FAILED, "the failure is on record"

    inventory = db.get(Inventory, 2)
    assert inventory.reserved == 3, "the hold survives a failed attempt"

    # The gateway comes back — the Retry button opens a fresh attempt.
    monkeypatch.undo()
    retried, authority = _initiate(client, headers, order["id"])
    assert retried["payment_id"] != attempt.id, "a retry is a new attempt"
    _drive_gateway(client, authority, "ok")

    status = _payment_status(client, headers, retried["payment_id"])
    assert status["status"] == "paid"
    assert status["order_status"] == "confirmed"


def test_reservation_expiry_cancels_the_order_and_releases_the_hold(
    client, db, customer, seed_catalog
):
    from app.modules.notifications.models import NotificationType

    order, headers = _place_online_order(client, customer)
    _initiate(client, headers, order["id"])  # an attempt was open, never completed

    # Wind the clock forward past the payment window.
    db.expire_all()
    reservation = db.scalar(
        select(StockReservation).where(StockReservation.order_id == order["id"])
    )
    reservation.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    order_row = db.get(Order, order["id"])
    order_row.payment_deadline = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()

    summary = sweep_expired_reservations(db)
    assert summary == {"scanned": 1, "released": 3, "cancelled": 1, "consumed": 0}

    db.expire_all()
    order_row = db.get(Order, order["id"])
    assert order_row.status == OrderStatus.CANCELLED
    assert order_row.payment_status == PaymentStatus.FAILED

    inventory = db.get(Inventory, 2)
    assert inventory.quantity == 10, "the hold never took stock, so none goes back"
    assert inventory.reserved == 0
    assert inventory.available == 10

    reservation = db.scalar(
        select(StockReservation).where(StockReservation.order_id == order["id"])
    )
    assert reservation.status == ReservationStatus.RELEASED

    attempt = db.scalar(select(Payment).where(Payment.order_id == order["id"]))
    assert attempt.status == PaymentAttemptStatus.FAILED
    assert attempt.raw_response.get("expired") is True

    detail = client.get(f"/api/orders/{order['id']}", headers=headers).json()
    assert detail["status"] == "cancelled"
    assert any(h["note"] == "Payment timeout" for h in detail["history"])

    rows = list(
        db.scalars(
            select(Notification).where(
                Notification.user_id == _user_id(db, customer),
                Notification.type == NotificationType.ORDER_CANCELLED.value,
            )
        ).all()
    )
    assert rows, "the customer is told why the order vanished"
    assert any("payment" in (r.body or "").lower() for r in rows)

    # A cancelled order cannot be paid, and a second sweep changes nothing.
    assert client.post(
        f"/api/orders/{order['id']}/payments", headers=headers
    ).status_code == 409
    assert sweep_expired_reservations(db)["cancelled"] == 0
    db.expire_all()
    assert db.get(Inventory, 2).reserved == 0
    assert db.get(Inventory, 2).quantity == 10
    history = client.get(f"/api/orders/{order['id']}", headers=headers).json()
    assert [h["status"] for h in history["history"]] == ["pending", "cancelled"]


def test_sweeper_never_cancels_an_order_the_callback_already_paid(
    client, db, customer, seed_catalog
):
    """The race the sweeper has to lose: the payment lands while the expired
    candidate list is being worked through."""
    order, headers = _place_online_order(client, customer)
    _initiate(client, headers, order["id"])

    db.expire_all()
    reservation = db.scalar(
        select(StockReservation).where(StockReservation.order_id == order["id"])
    )
    reservation.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    order_row = db.get(Order, order["id"])
    order_row.payment_deadline = datetime.now(UTC) - timedelta(minutes=1)
    order_row.payment_status = PaymentStatus.PAID  # callback won the race
    db.commit()

    summary = sweep_expired_reservations(db)
    assert summary["consumed"] == 3
    assert summary["cancelled"] == 0

    db.expire_all()
    order_row = db.get(Order, order["id"])
    assert order_row.status == OrderStatus.PENDING, "the sweeper never cancels paid money"
    inventory = db.get(Inventory, 2)
    assert inventory.quantity == 7, "the hold became a sale"
    assert inventory.reserved == 0


def test_expired_window_refuses_a_new_attempt(client, db, customer, seed_catalog):
    order, headers = _place_online_order(client, customer)

    db.expire_all()
    reservation = db.scalar(
        select(StockReservation).where(StockReservation.order_id == order["id"])
    )
    reservation.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    order_row = db.get(Order, order["id"])
    order_row.payment_deadline = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()
    sweep_expired_reservations(db)

    db.expire_all()
    order_row = db.get(Order, order["id"])
    assert order_row.status == OrderStatus.CANCELLED
    late = client.post(f"/api/orders/{order['id']}/payments", headers=headers)
    assert late.status_code == 409


def test_refund_flow_full_partial_manual_and_cancellation(
    client, db, admin_user, customer, seed_catalog
):
    order, headers = _place_online_order(client, customer)
    started, authority = _initiate(client, headers, order["id"])
    _drive_gateway(client, authority, "ok")

    admin = login(client, admin_user)
    listing = client.get("/api/admin/payments", headers=admin).json()
    assert listing["total"] == 1
    payment = listing["items"][0]
    assert payment["order_number"] == order["order_number"]
    assert payment["status"] == "paid"

    # A live order cannot be refunded in full — cancel it instead.
    blocked = client.post(
        f"/api/admin/payments/{payment['id']}/refund", json={}, headers=admin
    )
    assert blocked.status_code == 409

    partial = client.post(
        f"/api/admin/payments/{payment['id']}/refund",
        json={"amount": 100, "reason": "Damaged on arrival"},
        headers=admin,
    )
    assert partial.status_code == 200, partial.text
    assert partial.json()["status"] == "partially_refunded"
    assert partial.json()["refunded_amount"] == 100

    db.expire_all()
    assert db.get(Order, order["id"]).payment_status == PaymentStatus.PARTIALLY_REFUNDED
    assert db.get(Inventory, 2).quantity == 7, "a refund does not restock"

    # More than what was paid is refused.
    too_much = client.post(
        f"/api/admin/payments/{payment['id']}/refund",
        json={"amount": 100_000},
        headers=admin,
    )
    assert too_much.status_code == 400

    # Cancelling settles the remainder: stock back, payment fully refunded.
    cancelled = client.patch(
        f"/api/admin/orders/{order['id']}/status",
        json={"status": "cancelled", "note": "Customer request"},
        headers=admin,
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["payment_status"] == "refunded"

    db.expire_all()
    payment_row = db.get(Payment, started["payment_id"])
    assert payment_row.status == PaymentAttemptStatus.REFUNDED
    assert float(payment_row.refunded_amount) == float(payment_row.amount)
    inventory = db.get(Inventory, 2)
    assert inventory.quantity == 10, "cancelling shelves the goods again"
    assert inventory.reserved == 0


def test_manual_refund_is_recorded_as_bookkeeping(
    client, db, admin_user, customer, seed_catalog
):
    order, headers = _place_online_order(client, customer)
    started, authority = _initiate(client, headers, order["id"])
    _drive_gateway(client, authority, "ok")

    admin = login(client, admin_user)
    manual = client.post(
        f"/api/admin/payments/{started['payment_id']}/refund",
        json={"amount": 50, "reason": "Bank transfer issued directly", "manual": True},
        headers=admin,
    )
    assert manual.status_code == 200, manual.text

    db.expire_all()
    payment = db.get(Payment, started["payment_id"])
    assert payment.status == PaymentAttemptStatus.PARTIALLY_REFUNDED
    assert payment.raw_response["refund"]["manual"] is True
    assert payment.raw_response["refund"]["reason"] == "Bank transfer issued directly"


def test_admin_payment_list_filters_sorts_and_pages(
    client, db, admin_user, customer, seed_catalog
):
    # Two orders: one online (paid), one COD (still pending).
    order, headers = _place_online_order(client, customer)
    started, authority = _initiate(client, headers, order["id"])
    _drive_gateway(client, authority, "ok")

    client.post(
        "/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers
    )
    cod = client.post(
        "/api/checkout", json={"address": ADDRESS, "payment_method": "cod"},
        headers=headers,
    )
    assert cod.status_code == 201, cod.text

    admin = login(client, admin_user)

    everything = client.get("/api/admin/payments", headers=admin).json()
    assert everything["total"] == 2

    paid = client.get(
        "/api/admin/payments", params={"status": "paid"}, headers=admin
    ).json()
    assert paid["total"] == 1
    assert paid["items"][0]["provider"] == "zarinpal"

    pending = client.get(
        "/api/admin/payments", params={"status": "pending"}, headers=admin
    ).json()
    assert pending["total"] == 1
    assert pending["items"][0]["provider"] == "cod"

    by_provider = client.get(
        "/api/admin/payments", params={"provider": "cod"}, headers=admin
    ).json()
    assert by_provider["total"] == 1

    by_number = client.get(
        "/api/admin/payments",
        params={"q": order["order_number"]},
        headers=admin,
    ).json()
    assert by_number["total"] == 1
    assert by_number["items"][0]["order_number"] == order["order_number"]

    assert client.get(
        "/api/admin/payments", params={"q": "ZZZZ"}, headers=admin
    ).json()["total"] == 0

    today = client.get(
        "/api/admin/payments",
        params={"start": datetime.now(UTC).date().isoformat()},
        headers=admin,
    ).json()
    assert today["total"] == 2
    tomorrow = datetime.now(UTC) + timedelta(days=1)
    assert client.get(
        "/api/admin/payments",
        params={"start": tomorrow.date().isoformat()},
        headers=admin,
    ).json()["total"] == 0

    first_page = client.get(
        "/api/admin/payments", params={"page": 1, "page_size": 1}, headers=admin
    ).json()
    assert first_page["total"] == 2
    assert first_page["pages"] == 2
    assert len(first_page["items"]) == 1

    cheapest = client.get(
        "/api/admin/payments", params={"sort": "amount_asc"}, headers=admin
    ).json()
    assert cheapest["items"][0]["amount"] <= cheapest["items"][1]["amount"]

    # Detail carries the attempts and whatever the gateway actually said.
    detail = client.get(
        f"/api/admin/payments/{started['payment_id']}", headers=admin
    ).json()
    assert detail["order_number"] == order["order_number"]
    assert detail["order_status"] == "confirmed"
    assert len(detail["attempts"]) == 1
    assert "verify" in detail["raw_response"]


def test_payment_records_are_private(client, customer, seed_catalog):
    order, headers = _place_online_order(client, customer)
    started, _ = _initiate(client, headers, order["id"])

    stranger = client.post(
        "/api/auth/register",
        json={
            "email": "nosy@test.dev",
            "password": "Password1!",
            "full_name": "Nosy Neighbour",
        },
    )
    assert stranger.status_code == 201, stranger.text
    other = {"Authorization": f"Bearer {stranger.json()['access_token']}"}

    assert client.get(f"/api/payments/{started['payment_id']}", headers=other).status_code == 404
    assert client.post(
        f"/api/orders/{order['id']}/payments", headers=other
    ).status_code == 404
    assert client.get("/api/admin/payments", headers=other).status_code == 403


def test_cod_order_cannot_open_an_online_attempt(client, customer, seed_catalog):
    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 1}, headers=headers)
    cod = client.post(
        "/api/checkout", json={"address": ADDRESS, "payment_method": "cod"},
        headers=headers,
    )
    assert cod.status_code == 201, cod.text

    response = client.post(f"/api/orders/{cod.json()['id']}/payments", headers=headers)
    assert response.status_code == 400
