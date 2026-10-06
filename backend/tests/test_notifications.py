"""Notifications: one notify() path, the inbox endpoints, email via the provider.

Each event source is checked where it fires (checkout / status change /
review hide), plus the inbox contract: pagination + filter + sort, unread
counts, and mark-read isolation between users.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.email import ConsoleEmailProvider, EmailProvider, set_email_provider
from app.modules.notifications.models import Notification, NotificationType
from app.modules.notifications.service import notify
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

SLUG = "test-oats"


def _place_order(client, email: str, variant_id: int = 2, quantity: int = 2) -> tuple[dict, dict]:
    headers = login(client, email)
    client.post(
        "/api/cart/items", json={"variant_id": variant_id, "quantity": quantity}, headers=headers
    )
    response = client.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json(), headers


def _user_id(db, email: str) -> int:
    from app.modules.users.models import User

    return db.scalar(select(User.id).where(User.email == email))


def _rows(db, user_id: int) -> list[Notification]:
    return list(
        db.scalars(
            select(Notification).where(Notification.user_id == user_id).order_by(Notification.id)
        ).all()
    )


def test_order_placed_notifies_the_customer(client, db, customer, seed_catalog):
    order, headers = _place_order(client, customer)

    db.expire_all()
    rows = _rows(db, _user_id(db, customer))
    assert [r.type for r in rows] == ["order_placed"]
    assert rows[0].read_at is None
    assert rows[0].link == f"/orders/{order['id']}"
    assert order["order_number"] in rows[0].title

    # ...and it is readable through the inbox API straight away.
    inbox = client.get("/api/notifications", headers=headers).json()
    assert inbox["total"] == 1
    assert inbox["items"][0]["type"] == "order_placed"


def test_status_moves_notify_the_customer_not_the_actor(
    client, db, admin_user, customer, seed_catalog
):
    admin_headers = login(client, admin_user)
    order, headers = _place_order(client, customer)

    confirmed = client.patch(
        f"/api/admin/orders/{order['id']}/status",
        json={"status": "confirmed", "note": "called the customer"},
        headers=admin_headers,
    )
    assert confirmed.status_code == 200, confirmed.text
    cancelled = client.post(f"/api/orders/{order['id']}/cancel", headers=headers)
    assert cancelled.status_code == 200, cancelled.text

    db.expire_all()
    rows = _rows(db, _user_id(db, customer))
    assert [r.type for r in rows] == ["order_placed", "order_status", "order_cancelled"]

    status_row = next(r for r in rows if r.type == "order_status")
    assert order["order_number"] in status_row.title
    assert status_row.body == "called the customer"  # the admin's note is the message
    assert status_row.link == f"/orders/{order['id']}"

    # The staff actor hears nothing from their own click.
    assert _rows(db, _user_id(db, admin_user)) == []


def test_review_hidden_notifies_its_author_once(client, db, admin_user, customer, seed_catalog):
    headers = login(client, customer)
    created = client.post(
        f"/api/products/{SLUG}/reviews",
        json={"rating": 5, "title": "Great", "body": "Really good oats."},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    review_id = created.json()["id"]

    admin_headers = login(client, admin_user)
    hidden = client.patch(
        f"/api/admin/reviews/{review_id}", json={"is_visible": False}, headers=admin_headers
    )
    assert hidden.status_code == 200, hidden.text

    db.expire_all()
    rows = _rows(db, _user_id(db, customer))
    assert [r.type for r in rows] == ["review_hidden"]
    assert rows[0].link == f"/p/{SLUG}"
    assert SLUG in (rows[0].body or "") or "product page" in (rows[0].body or "")

    # Unhiding is the moderator undoing their own action — not a second message.
    unhidden = client.patch(
        f"/api/admin/reviews/{review_id}", json={"is_visible": True}, headers=admin_headers
    )
    assert unhidden.status_code == 200, unhidden.text
    db.expire_all()
    assert len(_rows(db, _user_id(db, customer))) == 1


def test_inbox_pagination_filter_and_sort(client, db, customer, seed_catalog):
    headers = login(client, customer)
    user_id = _user_id(db, customer)
    base = datetime.now(UTC)
    for i in range(5):
        db.add(
            Notification(
                user_id=user_id,
                type="order_status",
                title=f"Note {i}",
                created_at=base + timedelta(minutes=i),
                updated_at=base + timedelta(minutes=i),
                read_at=base + timedelta(minutes=i) if i % 2 == 0 else None,
            )
        )
    db.commit()

    page_one = client.get(
        "/api/notifications", params={"page": 1, "page_size": 2}, headers=headers
    ).json()
    assert page_one["total"] == 5
    assert page_one["pages"] == 3
    assert len(page_one["items"]) == 2

    oldest = client.get(
        "/api/notifications", params={"sort": "oldest", "page_size": 10}, headers=headers
    ).json()
    assert [n["title"] for n in oldest["items"]] == [f"Note {i}" for i in range(5)]

    newest = client.get(
        "/api/notifications", params={"sort": "newest", "page_size": 10}, headers=headers
    ).json()
    assert [n["title"] for n in newest["items"]] == [f"Note {i}" for i in range(4, -1, -1)]

    unread = client.get(
        "/api/notifications", params={"unread": True, "page_size": 10}, headers=headers
    ).json()
    assert unread["total"] == 2
    assert all(n["read_at"] is None for n in unread["items"])


def test_unread_count_mark_read_and_user_isolation(
    client, db, customer, admin_user, seed_catalog
):
    headers = login(client, customer)
    user_id = _user_id(db, customer)
    for i in range(3):
        db.add(
            Notification(
                user_id=user_id, type="order_status", title=f"Incoming {i}", updated_at=datetime.now(UTC)
            )
        )
    other_id = _user_id(db, admin_user)
    db.add(
        Notification(
            user_id=other_id, type="announcement", title="Staff note", updated_at=datetime.now(UTC)
        )
    )
    db.commit()

    assert client.get("/api/notifications/unread-count", headers=headers).json() == {"count": 3}

    first = client.get("/api/notifications", params={"page_size": 1}, headers=headers).json()[
        "items"
    ][0]
    read = client.post(f"/api/notifications/{first['id']}/read", headers=headers)
    assert read.status_code == 200, read.text
    assert read.json()["read_at"] is not None
    # Idempotent: reading twice is a 200, not a conflict.
    assert client.post(
        f"/api/notifications/{first['id']}/read", headers=headers
    ).status_code == 200
    assert client.get("/api/notifications/unread-count", headers=headers).json() == {"count": 2}

    # Someone else's row: 404 here, unread over there.
    other_row = db.scalar(select(Notification).where(Notification.user_id == other_id))
    assert (
        client.post(f"/api/notifications/{other_row.id}/read", headers=headers).status_code == 404
    )
    db.expire_all()
    assert db.get(Notification, other_row.id).read_at is None

    assert client.get("/api/notifications").status_code == 401

    all_read = client.post("/api/notifications/read-all", headers=headers)
    assert all_read.status_code == 200, all_read.text
    assert all_read.json() == {"updated": 2}
    assert client.get("/api/notifications/unread-count", headers=headers).json() == {"count": 0}
    # read-all never bleeds into another user's inbox.
    db.expire_all()
    assert db.get(Notification, other_row.id).read_at is None


def test_notification_email_goes_through_the_provider(db, customer):
    captured: list[dict] = []

    class Capture(EmailProvider):
        def send(self, *, to: str, subject: str, body: str) -> None:
            captured.append({"to": to, "subject": subject, "body": body})

    set_email_provider(Capture())
    try:
        notify(
            db,
            user_id=_user_id(db, customer),
            type=NotificationType.ANNOUNCEMENT,
            title="Weekend deal inside",
            body="Everything you saved is on offer.",
            link="/products",
        )
        db.commit()
    finally:
        set_email_provider(ConsoleEmailProvider())

    assert len(captured) == 1
    mail = captured[0]
    assert mail["to"] == customer
    assert mail["subject"] == "Weekend deal inside"
    assert "Everything you saved is on offer." in mail["body"]
    assert "Open: /products" in mail["body"]


def test_rolled_back_action_leaves_no_notification(db, customer):
    user_id = _user_id(db, customer)
    notify(db, user_id=user_id, type=NotificationType.ORDER_PLACED, title="Never lands")
    db.rollback()

    db.expire_all()
    assert _rows(db, user_id) == []
