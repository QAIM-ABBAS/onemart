"""Reviews: verified-purchase derivation, denormalised ratings, moderation.

Covered here because each layer has its own way to rot:
  * `verified_purchase` must come from delivered orders, never the client
  * product.rating_avg/rating_count are rewritten inside the review's transaction
  * hidden reviews leave both the public list *and* the average
  * one review per customer per product, one helpful mark per customer
"""

from sqlalchemy import select

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

SLUG = "test-oats"


def _register(client, email: str, name: str) -> dict:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": PASSWORD, "full_name": name},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _review(**overrides) -> dict:
    payload = {"rating": 5, "title": "Really good", "body": "Great value for the price."}
    payload.update(overrides)
    return payload


def _create(client, headers, payload: dict | None = None, slug: str = SLUG) -> dict:
    response = client.post(
        f"/api/products/{slug}/reviews", json=payload or _review(), headers=headers
    )
    assert response.status_code == 201, response.text
    return response.json()


def _place_order(client, headers, variant_id: int, quantity: int = 3) -> dict:
    client.post(
        "/api/cart/items",
        json={"variant_id": variant_id, "quantity": quantity},
        headers=headers,
    )
    response = client.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def _advance(client, order_id: int, admin_headers: dict, *statuses: str) -> None:
    for status in statuses:
        response = client.patch(
            f"/api/admin/orders/{order_id}/status",
            json={"status": status},
            headers=admin_headers,
        )
        assert response.status_code == 200, response.text


def _product(db) -> "object":
    from app.modules.catalog.models import Product

    db.expire_all()
    product = db.scalar(select(Product).where(Product.slug == SLUG))
    assert product is not None
    return product


# --------------------------------------------------------------------------- #
# Validation + authentication
# --------------------------------------------------------------------------- #


def test_guest_cannot_write_and_payload_is_validated(client, seed_catalog):
    guest = client.post(f"/api/products/{SLUG}/reviews", json=_review())
    assert guest.status_code == 401
    assert guest.json()["error"]["code"] == "unauthorized"


def test_invalid_rating_and_short_fields_rejected(client, customer, seed_catalog):
    headers = login(client, customer)

    high = client.post(
        f"/api/products/{SLUG}/reviews", json=_review(rating=6), headers=headers
    )
    assert high.status_code == 422

    low = client.post(
        f"/api/products/{SLUG}/reviews", json=_review(rating=0), headers=headers
    )
    assert low.status_code == 422

    short_title = client.post(
        f"/api/products/{SLUG}/reviews", json=_review(title="ok"), headers=headers
    )
    assert short_title.status_code == 422

    short_body = client.post(
        f"/api/products/{SLUG}/reviews", json=_review(body="nice"), headers=headers
    )
    assert short_body.status_code == 422


# --------------------------------------------------------------------------- #
# verified_purchase — server-derived from delivered orders
# --------------------------------------------------------------------------- #


def test_verified_purchase_computed_from_delivery_not_from_client(
    client, db, admin_user, customer, seed_catalog
):
    headers = login(client, customer)
    admin_headers = login(client, admin_user)
    order = _place_order(client, headers, seed_catalog["large"].id)

    # The client claims the badge; the server must ignore it while the order
    # is still pending.
    created = _create(
        client, headers, _review(verified_purchase=True)
    )
    assert created["verified_purchase"] is False

    _advance(
        client, order["id"], admin_headers, "confirmed", "packed", "shipped", "delivered"
    )

    # Re-saving the same text after delivery picks the flag up server-side.
    edited = client.patch(
        f"/api/reviews/{created['id']}", json=_review(), headers=headers
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["verified_purchase"] is True

    # A customer who never ordered gets no badge.
    other_headers = _register(client, "bystander@test.dev", "Bystander")
    other = _create(client, other_headers, _review(rating=4))
    assert other["verified_purchase"] is False


def test_one_review_per_customer_per_product(client, db, customer, seed_catalog):
    headers = login(client, customer)
    first = _create(client, headers)
    assert first["rating"] == 5

    second = client.post(
        f"/api/products/{SLUG}/reviews", json=_review(rating=1), headers=headers
    )
    assert second.status_code == 409
    assert second.json()["error"]["details"]["review_id"] == first["id"]

    # The rejected attempt left the average alone.
    product = _product(db)
    assert product.rating_count == 1
    assert product.rating_avg == 5


# --------------------------------------------------------------------------- #
# Denormalised rating_avg / rating_count
# --------------------------------------------------------------------------- #


def test_rating_columns_follow_create_edit_delete(client, db, customer, seed_catalog):
    from decimal import Decimal

    headers = login(client, customer)
    second_headers = _register(client, "second@test.dev", "Second Reviewer")

    _create(client, headers, _review(rating=5))
    _create(client, second_headers, _review(rating=4, title="Solid buy", body="Would buy again."))

    product = _product(db)
    assert product.rating_count == 2
    assert product.rating_avg == Decimal("4.50")

    mine = client.get(f"/api/products/{SLUG}/reviews", headers=headers).json()
    own = next(r for r in mine["items"] if r["author"] == "Casey Customer")
    edited = client.patch(f"/api/reviews/{own['id']}", json=_review(rating=1), headers=headers)
    assert edited.status_code == 200

    product = _product(db)
    assert product.rating_count == 2
    assert product.rating_avg == Decimal("2.50")

    deleted = client.delete(f"/api/reviews/{own['id']}", headers=headers)
    assert deleted.status_code == 204

    product = _product(db)
    assert product.rating_count == 1
    assert product.rating_avg == Decimal("4.00")


# --------------------------------------------------------------------------- #
# Product detail carries the summary (and the cache notices writes)
# --------------------------------------------------------------------------- #


def test_product_detail_includes_rating_summary(client, customer, seed_catalog):
    empty = client.get(f"/api/products/{SLUG}").json()
    assert empty["rating_avg"] == 0.0
    assert empty["rating_count"] == 0
    assert [b["count"] for b in empty["rating_distribution"]] == [0, 0, 0, 0, 0]

    headers = login(client, customer)
    _create(client, headers, _review(rating=5))

    fresh = client.get(f"/api/products/{SLUG}").json()
    assert fresh["rating_avg"] == 5.0
    assert fresh["rating_count"] == 1
    assert [b["rating"] for b in fresh["rating_distribution"]] == [5, 4, 3, 2, 1]
    assert [b["count"] for b in fresh["rating_distribution"]] == [1, 0, 0, 0, 0]


# --------------------------------------------------------------------------- #
# Public listing: sort, filter, pagination, ownership flags
# --------------------------------------------------------------------------- #


def test_public_list_sorts_filters_and_paginates(client, customer, seed_catalog):
    headers = login(client, customer)
    u2 = _register(client, "u2@test.dev", "Two")
    u3 = _register(client, "u3@test.dev", "Three")

    first = _create(client, headers, _review(rating=5))
    second = _create(client, u2, _review(rating=3, title="It is fine", body="Does the job."))
    third = _create(client, u3, _review(rating=1, title="Not for me", body="Broke within a week."))

    # helpful marks: first review gets two, second gets one
    assert client.post(f"/api/reviews/{first['id']}/helpful", headers=u2).json()["helpful_count"] == 1
    assert client.post(f"/api/reviews/{first['id']}/helpful", headers=u3).json()["helpful_count"] == 2
    assert client.post(f"/api/reviews/{second['id']}/helpful", headers=headers).json()["helpful_count"] == 1

    newest = client.get(f"/api/products/{SLUG}/reviews", params={"sort": "newest"}).json()
    assert [r["id"] for r in newest["items"]] == [third["id"], second["id"], first["id"]]

    highest = client.get(f"/api/products/{SLUG}/reviews", params={"sort": "highest"}).json()
    assert [r["rating"] for r in highest["items"]] == [5, 3, 1]

    lowest = client.get(f"/api/products/{SLUG}/reviews", params={"sort": "lowest"}).json()
    assert [r["rating"] for r in lowest["items"]] == [1, 3, 5]

    helpful = client.get(f"/api/products/{SLUG}/reviews", params={"sort": "most_helpful"}).json()
    assert helpful["items"][0]["id"] == first["id"]
    assert helpful["items"][0]["helpful_count"] == 2

    filtered = client.get(
        f"/api/products/{SLUG}/reviews", params={"rating": 3}, headers=u3
    ).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["id"] == second["id"]

    # The viewer's own votes and edit rights follow the session.
    assert filtered["items"][0]["viewer_has_voted"] is False
    mine_view = client.get(
        f"/api/products/{SLUG}/reviews", params={"rating": 3}, headers=headers
    ).json()
    assert mine_view["items"][0]["viewer_has_voted"] is True
    assert mine_view["items"][0]["can_edit"] is False
    own_view = client.get(f"/api/products/{SLUG}/reviews", headers=u2).json()
    own = next(r for r in own_view["items"] if r["id"] == second["id"])
    assert own["can_edit"] is True

    page_one = client.get(
        f"/api/products/{SLUG}/reviews", params={"page": 1, "page_size": 2}
    ).json()
    assert page_one["total"] == 3
    assert page_one["pages"] == 2
    assert len(page_one["items"]) == 2

    page_two = client.get(
        f"/api/products/{SLUG}/reviews", params={"page": 2, "page_size": 2}
    ).json()
    assert len(page_two["items"]) == 1
    assert page_two["items"][0]["id"] == first["id"]

    summary = page_one["summary"]
    assert summary["count"] == 3
    assert summary["average"] == 3.0
    # 5, 3, 1 -> one each at index 0, 2 and 4 (ratings 5..1)
    assert [b["count"] for b in summary["distribution"]] == [1, 0, 1, 0, 1]


def test_empty_review_list_has_real_empty_state(client, seed_catalog):
    page = client.get(f"/api/products/{SLUG}/reviews").json()
    assert page["items"] == []
    assert page["total"] == 0
    assert page["pages"] == 1
    assert page["summary"] == {
        "average": 0.0,
        "count": 0,
        "distribution": [
            {"rating": 5, "count": 0},
            {"rating": 4, "count": 0},
            {"rating": 3, "count": 0},
            {"rating": 2, "count": 0},
            {"rating": 1, "count": 0},
        ],
    }


# --------------------------------------------------------------------------- #
# Moderation: hide/unhide/delete + audit log
# --------------------------------------------------------------------------- #


def test_hidden_review_leaves_public_list_and_average(
    client, db, admin_user, customer, seed_catalog
):
    from app.modules.audit.models import AuditLog
    from app.modules.users.models import User

    headers = login(client, customer)
    other_headers = _register(client, "harsh@test.dev", "Harsh")
    high = _create(client, headers, _review(rating=5))
    low = _create(
        client, other_headers, _review(rating=1, title="Awful", body="Never arrived intact.")
    )

    admin_headers = login(client, admin_user)
    hidden = client.patch(
        f"/api/admin/reviews/{high['id']}", json={"is_visible": False}, headers=admin_headers
    )
    assert hidden.status_code == 200, hidden.text
    assert hidden.json()["is_visible"] is False

    listed = client.get(f"/api/products/{SLUG}/reviews").json()
    assert [r["id"] for r in listed["items"]] == [low["id"]]
    assert listed["summary"]["count"] == 1
    assert listed["summary"]["average"] == 1.0

    product = _product(db)
    assert product.rating_count == 1
    assert product.rating_avg == 1.0

    # Hiding twice is a conflict, not a silent no-op.
    again = client.patch(
        f"/api/admin/reviews/{high['id']}", json={"is_visible": False}, headers=admin_headers
    )
    assert again.status_code == 409

    admin_id = db.scalar(select(User.id).where(User.email == admin_user))
    entry = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "review.hide", AuditLog.entity_id == high["id"]
        )
    )
    assert entry is not None
    assert entry.actor_id == admin_id
    assert entry.entity == "review"
    assert entry.detail["product_id"] == high["product_id"]

    unhidden = client.patch(
        f"/api/admin/reviews/{high['id']}", json={"is_visible": True}, headers=admin_headers
    )
    assert unhidden.status_code == 200
    assert client.get(f"/api/products/{SLUG}/reviews").json()["summary"]["count"] == 2
    assert _product(db).rating_avg == 3.0


def test_admin_review_queue_filters_searches_and_requires_staff(
    client, db, admin_user, customer, seed_catalog
):
    from sqlalchemy import func

    from app.modules.reviews.models import Review

    headers = login(client, customer)
    other_headers = _register(client, "meh@test.dev", "Meh")
    high = _create(client, headers, _review(rating=5))
    low = _create(
        client, other_headers, _review(rating=2, title="Below par", body="Not what I expected."
    ))

    customer_headers = login(client, customer)
    assert client.get("/api/admin/reviews", headers=customer_headers).status_code == 403

    admin_headers = login(client, admin_user)
    everything = client.get("/api/admin/reviews", headers=admin_headers).json()
    assert everything["total"] == 2

    by_rating = client.get(
        "/api/admin/reviews", params={"rating": 2}, headers=admin_headers
    ).json()
    assert by_rating["total"] == 1
    assert by_rating["items"][0]["id"] == low["id"]

    by_product = client.get(
        "/api/admin/reviews", params={"product_id": high["product_id"]}, headers=admin_headers
    ).json()
    assert by_product["total"] == 2

    by_author = client.get(
        "/api/admin/reviews", params={"q": "Meh"}, headers=admin_headers
    ).json()
    assert by_author["total"] == 1
    assert by_author["items"][0]["id"] == low["id"]

    by_name = client.get(
        "/api/admin/reviews", params={"q": "Oats"}, headers=admin_headers
    ).json()
    assert by_name["total"] == 2

    no_match = client.get(
        "/api/admin/reviews", params={"q": "zzz"}, headers=admin_headers
    ).json()
    assert no_match["total"] == 0

    highest = client.get(
        "/api/admin/reviews", params={"sort": "highest"}, headers=admin_headers
    ).json()
    assert [r["rating"] for r in highest["items"]] == [5, 2]

    first_page = client.get(
        "/api/admin/reviews", params={"page": 1, "page_size": 1}, headers=admin_headers
    ).json()
    assert first_page["total"] == 2
    assert first_page["pages"] == 2

    # Moderation status filter flips after a hide.
    client.patch(
        f"/api/admin/reviews/{high['id']}", json={"is_visible": False}, headers=admin_headers
    )
    hidden = client.get(
        "/api/admin/reviews", params={"status": "hidden"}, headers=admin_headers
    ).json()
    assert hidden["total"] == 1
    assert hidden["items"][0]["id"] == high["id"]

    visible = client.get(
        "/api/admin/reviews", params={"status": "visible"}, headers=admin_headers
    ).json()
    assert visible["total"] == 1
    assert visible["items"][0]["id"] == low["id"]

    assert db.scalar(select(func.count()).select_from(Review)) == 2


def test_admin_delete_removes_review_recomputes_and_audits(
    client, db, admin_user, customer, seed_catalog
):
    from app.modules.audit.models import AuditLog

    headers = login(client, customer)
    review = _create(client, headers, _review(rating=5))
    assert _product(db).rating_count == 1

    admin_headers = login(client, admin_user)
    deleted = client.delete(f"/api/admin/reviews/{review['id']}", headers=admin_headers)
    assert deleted.status_code == 204

    assert client.get(f"/api/products/{SLUG}/reviews").json()["total"] == 0
    assert _product(db).rating_count == 0
    assert _product(db).rating_avg == 0

    entry = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "review.delete", AuditLog.entity_id == review["id"]
        )
    )
    assert entry is not None
    assert entry.detail["rating"] == 5

    assert (
        client.delete(f"/api/admin/reviews/{review['id']}", headers=admin_headers).status_code
        == 404
    )


# --------------------------------------------------------------------------- #
# Permissions on the customer side
# --------------------------------------------------------------------------- #


def test_customers_cannot_edit_or_delete_others_reviews(client, customer, seed_catalog):
    headers = login(client, customer)
    review = _create(client, headers)

    intruder = _register(client, "intruder@test.dev", "Intruder")
    assert (
        client.patch(
            f"/api/reviews/{review['id']}", json=_review(rating=1), headers=intruder
        ).status_code
        == 403
    )
    assert client.delete(f"/api/reviews/{review['id']}", headers=intruder).status_code == 403

    assert client.patch(f"/api/reviews/{review['id']}", json=_review()).status_code == 401
    assert client.delete(f"/api/reviews/{review['id']}").status_code == 401
    assert client.post(f"/api/reviews/{review['id']}/helpful").status_code == 401


# --------------------------------------------------------------------------- #
# Helpful marks
# --------------------------------------------------------------------------- #


def test_helpful_toggle_counts_each_customer_once(client, customer, seed_catalog):
    headers = login(client, customer)
    review = _create(client, headers)
    u2 = _register(client, "voter2@test.dev", "Voter Two")

    first = client.post(f"/api/reviews/{review['id']}/helpful", headers=u2)
    assert first.status_code == 200
    assert first.json() == {"helpful_count": 1, "viewer_has_voted": True}

    # Toggling off removes the mark — never a negative or doubled count.
    second = client.post(f"/api/reviews/{review['id']}/helpful", headers=u2)
    assert second.json() == {"helpful_count": 0, "viewer_has_voted": False}

    third = client.post(f"/api/reviews/{review['id']}/helpful", headers=u2)
    assert third.json() == {"helpful_count": 1, "viewer_has_voted": True}

    # The owner sees the count through their own session too.
    page = client.get(f"/api/products/{SLUG}/reviews", headers=headers).json()
    assert page["items"][0]["helpful_count"] == 1
    assert page["items"][0]["viewer_has_voted"] is False
