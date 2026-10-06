"""Admin CRUD for coupons and automatic discounts.

Each screen-level promise gets a test: validation (dates, percent sanity, code
uniqueness, overlap), status chips + the status filter that must agree with
them, usage counts, pagination/sort/search, and staff-only access.
"""

from datetime import UTC, datetime, timedelta

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


def _coupon(client, headers, **overrides):
    payload = {"code": "SAVE10", "kind": "percent", "value": 10}
    payload.update(overrides)
    return client.post("/api/admin/coupons", json=payload, headers=headers)


def _discount(client, headers, **overrides):
    payload = {"scope": "product", "kind": "percent", "value": 10}
    payload.update(overrides)
    return client.post("/api/admin/discounts", json=payload, headers=headers)


def _field_error(response) -> str:
    error = response.json()["error"]
    assert error["details"], error
    return error["details"][0]["field"]


def test_admin_discount_endpoints_require_staff(client, db, customer, seed_catalog):
    # guests -> 401
    assert client.get("/api/admin/coupons").status_code == 401
    assert (
        client.post(
            "/api/admin/discounts",
            json={"scope": "product", "kind": "percent", "value": 10, "product_id": 1},
        ).status_code
        == 401
    )
    # a customer -> 403
    headers = login(client, customer)
    assert client.get("/api/admin/coupons", headers=headers).status_code == 403
    assert client.get("/api/admin/discounts", headers=headers).status_code == 403


def test_coupon_create_partial_update_and_status_chips(client, db, admin_user):
    headers = login(client, admin_user)

    created = _coupon(
        client, headers, code="  save10 ", min_subtotal=499, max_discount=200, description="10% off"
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["code"] == "SAVE10"  # whitespace and case are normalised
    assert body["status"] == "active"
    assert body["is_active"] is True
    assert body["used_count"] == 0

    # a partial PATCH flips only the field it names
    off = client.patch(
        f"/api/admin/coupons/{body['id']}", json={"is_active": False}, headers=headers
    )
    assert off.status_code == 200, off.text
    assert off.json()["status"] == "inactive"
    assert off.json()["code"] == "SAVE10"
    assert off.json()["value"] == 10

    bumped = client.patch(f"/api/admin/coupons/{body['id']}", json={"value": 15}, headers=headers)
    assert bumped.json()["value"] == 15
    assert bumped.json()["status"] == "inactive"

    now = datetime.now(UTC)
    scheduled = client.patch(
        f"/api/admin/coupons/{body['id']}",
        json={
            "is_active": True,
            "starts_at": (now + timedelta(days=1)).isoformat(),
        },
        headers=headers,
    )
    assert scheduled.json()["status"] == "scheduled"

    expired = client.patch(
        f"/api/admin/coupons/{body['id']}",
        json={
            "starts_at": (now - timedelta(days=8)).isoformat(),
            "ends_at": (now - timedelta(days=1)).isoformat(),
        },
        headers=headers,
    )
    assert expired.json()["status"] == "expired"

    # the status filter agrees with the chips
    listed = client.get("/api/admin/coupons?status=expired", headers=headers).json()
    assert [row["code"] for row in listed["items"]] == ["SAVE10"]
    active = client.get("/api/admin/coupons?status=active", headers=headers).json()
    assert active["items"] == []

    assert (
        client.delete(f"/api/admin/coupons/{body['id']}", headers=headers).status_code == 204
    )
    assert client.get("/api/admin/coupons", headers=headers).json()["total"] == 0


def test_coupon_validation_rejects_bad_input(client, db, admin_user):
    headers = login(client, admin_user)
    assert _coupon(client, headers, code="DUP").status_code == 201

    duplicate = _coupon(client, headers, code=" dup ")
    assert duplicate.status_code == 409
    assert _field_error(duplicate) == "code"

    too_much = _coupon(client, headers, code="P150", value=150)
    assert too_much.status_code == 400
    assert _field_error(too_much) == "value"

    zero = _coupon(client, headers, code="ZERO", kind="fixed", value=0)
    assert zero.status_code == 400
    assert _field_error(zero) == "value"

    now = datetime.now(UTC)
    inverted = _coupon(
        client,
        headers,
        code="BACKWARDS",
        starts_at=(now + timedelta(days=2)).isoformat(),
        ends_at=(now + timedelta(days=1)).isoformat(),
    )
    assert inverted.status_code == 400
    assert _field_error(inverted) == "ends_at"

    missing = client.post(
        "/api/admin/coupons", json={"kind": "percent", "value": 5}, headers=headers
    )
    assert missing.status_code == 400
    assert _field_error(missing) == "code"

    # free_delivery carries no number of its own, whatever the form sends
    freeship = _coupon(client, headers, code="FREESHIP", kind="free_delivery", value=99)
    assert freeship.status_code == 201, freeship.text
    assert freeship.json()["value"] == 0
    assert freeship.json()["kind"] == "free_delivery"


def test_coupon_list_paginates_searches_and_sorts(client, db, admin_user):
    headers = login(client, admin_user)
    assert _coupon(client, headers, code="BBB").status_code == 201
    assert _coupon(client, headers, code="AAA").status_code == 201
    assert _coupon(client, headers, code="CCC", is_active=False).status_code == 201

    page1 = client.get("/api/admin/coupons?page=1&page_size=2&sort=code", headers=headers).json()
    assert page1["total"] == 3
    assert page1["pages"] == 2
    assert [row["code"] for row in page1["items"]] == ["AAA", "BBB"]

    page2 = client.get("/api/admin/coupons?page=2&page_size=2&sort=code", headers=headers).json()
    assert [row["code"] for row in page2["items"]] == ["CCC"]

    search = client.get("/api/admin/coupons?q=aaa", headers=headers).json()
    assert [row["code"] for row in search["items"]] == ["AAA"]

    inactive = client.get("/api/admin/coupons?status=inactive", headers=headers).json()
    assert [row["code"] for row in inactive["items"]] == ["CCC"]


def test_redeemed_coupon_can_be_switched_off_but_not_deleted(
    client, db, admin_user, customer, seed_catalog
):
    admin = login(client, admin_user)
    created = _coupon(client, admin, code="USED10").json()

    headers = login(client, customer)
    client.post("/api/cart/items", json={"variant_id": 2, "quantity": 3}, headers=headers)
    assert (
        client.post("/api/cart/coupon", json={"code": "USED10"}, headers=headers).status_code
        == 200
    )
    assert client.post("/api/checkout", json={"address": ADDRESS}, headers=headers).status_code == 201

    blocked = client.delete(f"/api/admin/coupons/{created['id']}", headers=admin)
    assert blocked.status_code == 409
    assert "turn it off instead" in blocked.json()["error"]["message"]

    turned_off = client.patch(
        f"/api/admin/coupons/{created['id']}", json={"is_active": False}, headers=admin
    )
    assert turned_off.status_code == 200
    assert turned_off.json()["used_count"] == 1  # the usage count stays on screen


def test_discount_crud_shows_target_names_filters_and_sorts(
    client, db, admin_user, seed_catalog
):
    headers = login(client, admin_user)
    product_id = seed_catalog["product"].id
    category_id = seed_catalog["category"].id

    created = _discount(client, headers, product_id=product_id, value=10)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["product_name"] == "Test Oats"
    assert body["category_name"] is None
    assert body["status"] == "active"

    other = _discount(
        client, headers, scope="category", category_id=category_id, kind="fixed", value=50
    )
    assert other.status_code == 201, other.text
    assert other.json()["category_name"] == "Pantry"

    only_products = client.get("/api/admin/discounts?scope=product", headers=headers).json()
    assert [row["product_name"] for row in only_products["items"]] == ["Test Oats"]

    by_value = client.get("/api/admin/discounts?sort=value", headers=headers).json()
    assert [row["value"] for row in by_value["items"]] == [50, 10]

    search = client.get("/api/admin/discounts?q=oats", headers=headers).json()
    assert len(search["items"]) == 1

    paged = client.get("/api/admin/discounts?page=1&page_size=1", headers=headers).json()
    assert paged["total"] == 2
    assert paged["pages"] == 2

    patched = client.patch(
        f"/api/admin/discounts/{body['id']}", json={"value": 25}, headers=headers
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["value"] == 25
    assert patched.json()["product_name"] == "Test Oats"  # target untouched

    toggled = client.patch(
        f"/api/admin/discounts/{body['id']}", json={"is_active": False}, headers=headers
    )
    assert toggled.json()["status"] == "inactive"

    assert (
        client.delete(f"/api/admin/discounts/{body['id']}", headers=headers).status_code == 204
    )
    assert (
        client.delete(f"/api/admin/discounts/{body['id']}", headers=headers).status_code == 404
    )


def test_discount_validation_rejects_bad_targets_and_values(
    client, db, admin_user, seed_catalog
):
    headers = login(client, admin_user)
    product_id = seed_catalog["product"].id
    category_id = seed_catalog["category"].id

    no_target = _discount(client, headers)
    assert no_target.status_code == 400
    assert _field_error(no_target) == "product_id"

    mixed = _discount(client, headers, product_id=product_id, category_id=category_id)
    assert mixed.status_code == 400
    assert _field_error(mixed) == "category_id"

    missing = _discount(client, headers, product_id=999999)
    assert missing.status_code == 400
    assert "no longer exists" in missing.json()["error"]["message"]

    too_much = _discount(client, headers, product_id=product_id, value=150)
    assert too_much.status_code == 400
    assert _field_error(too_much) == "value"

    now = datetime.now(UTC)
    inverted = _discount(
        client,
        headers,
        product_id=product_id,
        starts_at=(now + timedelta(days=2)).isoformat(),
        ends_at=(now + timedelta(days=1)).isoformat(),
    )
    assert inverted.status_code == 400
    assert _field_error(inverted) == "ends_at"


def test_overlapping_percent_rules_on_one_target_are_rejected(
    client, db, admin_user, seed_catalog
):
    headers = login(client, admin_user)
    product_id = seed_catalog["product"].id
    category_id = seed_catalog["category"].id

    first = _discount(client, headers, product_id=product_id, value=10)  # open-ended
    assert first.status_code == 201, first.text
    first_id = first.json()["id"]

    clash = _discount(client, headers, product_id=product_id, value=15)
    assert clash.status_code == 409
    assert _field_error(clash) == "starts_at"

    # close the first window, then schedule the second strictly after it
    now = datetime.now(UTC)
    closed = client.patch(
        f"/api/admin/discounts/{first_id}",
        json={"ends_at": (now + timedelta(days=5)).isoformat()},
        headers=headers,
    )
    assert closed.status_code == 200, closed.text
    later = _discount(
        client,
        headers,
        product_id=product_id,
        value=15,
        starts_at=(now + timedelta(days=10)).isoformat(),
        ends_at=(now + timedelta(days=20)).isoformat(),
    )
    assert later.status_code == 201, later.text

    # a fixed rule may overlap: the engine picks the better single rule anyway
    fixed = _discount(client, headers, product_id=product_id, kind="fixed", value=40)
    assert fixed.status_code == 201, fixed.text

    # and a percent rule on a different target is never in conflict
    elsewhere = _discount(
        client, headers, scope="category", category_id=category_id, value=15
    )
    assert elsewhere.status_code == 201, elsewhere.text
