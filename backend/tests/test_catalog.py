

def test_categories_tree(client, seed_catalog):
    response = client.get("/api/categories")
    assert response.status_code == 200
    tree = response.json()
    assert tree[0]["name"] == "Pantry"
    assert tree[0]["product_count"] == 1


def test_product_list_pagination(client, db, seed_catalog):
    from app.modules.catalog.models import Product, ProductVariant
    from app.modules.inventory.models import Inventory

    for index in range(25):
        product = Product(
            name=f"Bulk Item {index:02d}",
            slug=f"bulk-item-{index:02d}",
            category_id=seed_catalog["category"].id,
            description="filler",
        )
        db.add(product)
        db.flush()
        variant = ProductVariant(
            product_id=product.id, sku=f"BULK-{index:02d}", name="Default", price=50 + index
        )
        db.add(variant)
        db.flush()
        db.add(Inventory(variant_id=variant.id, quantity=5))
    db.commit()

    first = client.get("/api/products?page=1&page_size=10").json()
    assert first["total"] == 26
    assert first["pages"] == 3
    assert len(first["items"]) == 10

    second = client.get("/api/products?page=3&page_size=10").json()
    assert len(second["items"]) == 6


def test_product_filter_and_sort(client, seed_catalog):
    cheapest = client.get("/api/products?sort=price_asc").json()["items"][0]
    assert cheapest["name"] == "Test Oats"
    assert cheapest["price"] == 100

    filtered = client.get("/api/products?category=pantry&min_price=150").json()
    assert filtered["total"] == 0

    searched = client.get("/api/products", params={"q": "oats"}).json()
    assert searched["total"] >= 1

    facets = client.get("/api/products/facets", params={"category": "pantry"}).json()
    assert facets["total"] == 1
    assert facets["min_price"] == 100


def test_product_detail_and_stock(client, seed_catalog):
    response = client.get("/api/products/test-oats")
    assert response.status_code == 200
    detail = response.json()
    assert detail["price"] == 100
    assert len(detail["variants"]) == 2
    default = next(v for v in detail["variants"] if v["is_default"])
    assert default["available"] == 1
    assert detail["in_stock"] is True


def test_home_payload(client, seed_catalog):
    payload = client.get("/api/home").json()
    assert "categories" in payload
    assert any(p["slug"] == "test-oats" for p in payload["featured"])


def test_unknown_product_404(client):
    assert client.get("/api/products/nope").status_code == 404
