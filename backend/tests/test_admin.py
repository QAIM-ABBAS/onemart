from tests.conftest import login


def _product_payload(category_id: int, **overrides) -> dict:
    payload = {
        "name": "Everyday Detergent",
        "category_id": category_id,
        "description": "Front-load friendly detergent powder.",
        "is_active": True,
        "is_featured": False,
        "variants": [
            {"sku": "DET-1KG", "name": "1 kg", "price": 99.0, "is_default": True, "initial_stock": 12},
            {"sku": "DET-4KG", "name": "4 kg", "price": 349.0, "is_default": False, "initial_stock": 4},
        ],
        "images": [{"url": "https://cdn.example.com/det.jpg", "alt": "detergent"}],
    }
    payload.update(overrides)
    return payload


def test_staff_cannot_use_admin_endpoints(client, customer, seed_catalog):
    headers = login(client, customer)
    assert client.get("/api/admin/products", headers=headers).status_code == 403


def test_product_crud(client, db, admin_user, seed_catalog):
    headers = login(client, admin_user)

    created = client.post(
        "/api/admin/products",
        json=_product_payload(seed_catalog["category"].id),
        headers=headers,
    )
    assert created.status_code == 201, created.text
    product = created.json()
    assert product["slug"] == "everyday-detergent"
    assert len(product["variants"]) == 2
    assert product["available"] == 16

    listed = client.get("/api/admin/products", params={"q": "detergent"}, headers=headers).json()
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == product["id"]

    updated = client.patch(
        f"/api/admin/products/{product['id']}",
        json=_product_payload(
            seed_catalog["category"].id,
            name="Everyday Detergent Refill",
            is_featured=True,
            variants=[
                {"sku": "DET-1KG", "name": "1 kg", "price": 95.0, "is_default": True},
                {"sku": "DET-8KG", "name": "8 kg", "price": 599.0, "is_default": False, "initial_stock": 6},
            ],
        ),
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["is_featured"] is True
    skus = {v["sku"] for v in body["variants"]}
    assert "DET-8KG" in skus
    # stock of the surviving variant is preserved (12), new variant starts at 6
    by_sku = {v["sku"]: v for v in body["variants"]}
    assert by_sku["DET-1KG"]["available"] == 12
    assert by_sku["DET-8KG"]["available"] == 6

    deleted = client.delete(f"/api/admin/products/{product['id']}", headers=headers)
    assert deleted.status_code == 204
    assert client.get(f"/api/products/{product['slug']}").status_code == 404


def test_duplicate_sku_rejected(client, db, admin_user, seed_catalog):
    headers = login(client, admin_user)
    first = client.post(
        "/api/admin/products", json=_product_payload(seed_catalog["category"].id), headers=headers
    )
    assert first.status_code == 201
    second = client.post(
        "/api/admin/products", json=_product_payload(seed_catalog["category"].id), headers=headers
    )
    assert second.status_code == 409


def test_category_crud_and_guards(client, admin_user, seed_catalog):
    headers = login(client, admin_user)

    created = client.post(
        "/api/admin/categories",
        json={"name": "Frozen Foods", "parent_id": None, "position": 5},
        headers=headers,
    )
    assert created.status_code == 201
    parent = created.json()
    assert parent["slug"] == "frozen-foods"

    child = client.post(
        "/api/admin/categories",
        json={"name": "Ice Cream", "parent_id": parent["id"]},
        headers=headers,
    )
    assert child.status_code == 201
    assert child.json()["parent_id"] == parent["id"]

    renamed = client.patch(
        f"/api/admin/categories/{child.json()['id']}",
        json={"name": "Frozen Desserts", "parent_id": parent["id"]},
        headers=headers,
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Frozen Desserts"

    # cannot delete a category that still has a child
    blocked = client.delete(f"/api/admin/categories/{parent['id']}", headers=headers)
    assert blocked.status_code == 409

    # cannot move a parent under its own child
    cycle = client.patch(
        f"/api/admin/categories/{parent['id']}",
        json={"name": "Frozen Foods", "parent_id": child.json()["id"]},
        headers=headers,
    )
    assert cycle.status_code == 400

    # cannot delete a category that still has products
    has_products = client.delete(
        f"/api/admin/categories/{seed_catalog['category'].id}", headers=headers
    )
    assert has_products.status_code == 409

    assert client.delete(f"/api/admin/categories/{child.json()['id']}", headers=headers).status_code == 204


def test_stock_adjustment(client, db, admin_user, seed_catalog):
    from app.modules.inventory.models import StockMovement

    headers = login(client, admin_user)

    adjusted = client.post(
        "/api/admin/inventory/adjust",
        json={"variant_id": 1, "delta": -1, "reason": "Damaged pack"},
        headers=headers,
    )
    assert adjusted.status_code == 200, adjusted.text
    assert adjusted.json()["quantity"] == 0

    reset = client.post(
        "/api/admin/inventory/adjust",
        json={"variant_id": 1, "set_to": 25, "reason": "Cycle count"},
        headers=headers,
    )
    assert reset.json()["quantity"] == 25

    negative = client.post(
        "/api/admin/inventory/adjust",
        json={"variant_id": 1, "delta": -100},
        headers=headers,
    )
    assert negative.status_code == 409

    rows = client.get("/api/admin/inventory", params={"q": "OAT-500"}, headers=headers).json()
    assert rows["items"][0]["quantity"] == 25

    movements = db.query(StockMovement).filter(StockMovement.variant_id == 1).all()
    assert len(movements) == 2
    assert movements[0].delta == -1
