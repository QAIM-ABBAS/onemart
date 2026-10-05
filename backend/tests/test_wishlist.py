"""Wishlist: auth gate, idempotent toggling, live pricing, per-customer isolation.

Covered here because each behaviour has its own way to rot:
  * the list must never serve a stale price or stock count
  * saving twice must not create two rows (unique constraint + service check)
  * one customer's hearts must be invisible to (and untouchable by) another
  * the list endpoint ships with pagination, filter and sort from day one
"""

from sqlalchemy import select

from tests.conftest import PASSWORD, login


def _register(client, email: str, name: str) -> dict:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": PASSWORD, "full_name": name},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _make_product(
    db,
    *,
    name: str,
    slug: str,
    price: int,
    stock: int = 5,
    active: bool = True,
    compare_at: int | None = None,
):
    from app.modules.catalog.models import Category, Product, ProductVariant
    from app.modules.inventory.models import Inventory

    category = db.scalar(select(Category).limit(1))
    if category is None:
        category = Category(name="Pantry", slug="pantry")
        db.add(category)
        db.flush()

    product = Product(
        name=name,
        slug=slug,
        category_id=category.id,
        description=f"{name} description",
        is_active=active,
    )
    db.add(product)
    db.flush()

    variant = ProductVariant(
        product_id=product.id,
        sku=f"{slug.upper()}-1",
        name="Default",
        price=price,
        compare_at_price=compare_at,
        is_default=True,
    )
    db.add(variant)
    db.flush()
    db.add(Inventory(variant_id=variant.id, quantity=stock))
    db.commit()
    return product


def test_wishlist_requires_a_session(client):
    assert client.get("/api/wishlist").status_code == 401
    assert client.get("/api/wishlist/ids").status_code == 401
    assert client.post("/api/wishlist/1").status_code == 401
    assert client.delete("/api/wishlist/1").status_code == 401


def test_save_returns_ids_and_a_full_list(client, customer, seed_catalog, db):
    headers = login(client, customer)
    product = seed_catalog["product"]

    created = client.post(f"/api/wishlist/{product.id}", headers=headers)
    assert created.status_code == 201, created.text
    assert created.json() == {"product_id": product.id, "saved": True, "count": 1}

    ids = client.get("/api/wishlist/ids", headers=headers).json()
    assert ids == {"ids": [product.id], "count": 1}

    page = client.get("/api/wishlist", headers=headers).json()
    assert page["total"] == 1
    item = page["items"][0]
    assert item["slug"] == "test-oats"
    # Two variants: 100 and 180, with stock 1 + 10.
    assert item["price"] == 100
    assert item["available"] == 11
    assert item["in_stock"] is True
    assert {v["id"] for v in item["variants"]} == {seed_catalog["small"].id, seed_catalog["large"].id}


def test_saving_twice_is_idempotent(client, customer, seed_catalog):
    headers = login(client, customer)
    product = seed_catalog["product"]

    first = client.post(f"/api/wishlist/{product.id}", headers=headers)
    second = client.post(f"/api/wishlist/{product.id}", headers=headers)
    assert first.status_code == 201
    assert second.status_code == 200, second.text
    assert second.json()["count"] == 1

    page = client.get("/api/wishlist", headers=headers).json()
    assert page["total"] == 1


def test_unsaving_is_idempotent(client, customer, seed_catalog):
    headers = login(client, customer)
    product = seed_catalog["product"]
    client.post(f"/api/wishlist/{product.id}", headers=headers)

    removed = client.delete(f"/api/wishlist/{product.id}", headers=headers)
    assert removed.status_code == 200, removed.text
    assert removed.json() == {"product_id": product.id, "saved": False, "count": 0}

    again = client.delete(f"/api/wishlist/{product.id}", headers=headers)
    assert again.status_code == 200
    assert client.get("/api/wishlist/ids", headers=headers).json()["ids"] == []


def test_cannot_save_a_missing_or_unpublished_product(client, customer, seed_catalog, db):
    headers = login(client, customer)
    assert client.post("/api/wishlist/99999", headers=headers).status_code == 404

    product = seed_catalog["product"]
    product.is_active = False
    db.commit()
    assert client.post(f"/api/wishlist/{product.id}", headers=headers).status_code == 404


def test_list_filters_sorts_and_paginates(client, customer, db):
    headers = login(client, customer)
    cheap = _make_product(db, name="Alpha Oats", slug="alpha-oats", price=100)
    mid = _make_product(db, name="Beta Biscuits", slug="beta-biscuits", price=200)
    dear = _make_product(db, name="Gamma Ghee", slug="gamma-ghee", price=300, stock=0)
    for product in (cheap, mid, dear):
        assert client.post(f"/api/wishlist/{product.id}", headers=headers).status_code == 201

    page1 = client.get("/api/wishlist?page=1&page_size=2", headers=headers).json()
    assert page1["total"] == 3
    assert page1["pages"] == 2
    assert len(page1["items"]) == 2

    page2 = client.get("/api/wishlist?page=2&page_size=2", headers=headers).json()
    assert len(page2["items"]) == 1

    by_price = client.get("/api/wishlist?sort=price_asc", headers=headers).json()["items"]
    assert [i["slug"] for i in by_price] == ["alpha-oats", "beta-biscuits", "gamma-ghee"]

    newest = client.get("/api/wishlist?sort=recent", headers=headers).json()["items"]
    assert [i["slug"] for i in newest] == ["gamma-ghee", "beta-biscuits", "alpha-oats"]

    search = client.get("/api/wishlist?q=ghee", headers=headers).json()
    assert [i["slug"] for i in search["items"]] == ["gamma-ghee"]

    in_stock = client.get("/api/wishlist?in_stock=true", headers=headers).json()
    assert {i["slug"] for i in in_stock["items"]} == {"alpha-oats", "beta-biscuits"}

    # Unknown sorts fall back to something stable instead of 500ing.
    fallback = client.get("/api/wishlist?sort=nonsense", headers=headers)
    assert fallback.status_code == 200
    assert fallback.json()["total"] == 3


def test_price_and_stock_are_read_live(client, customer, seed_catalog, db):
    headers = login(client, customer)
    small = seed_catalog["small"]
    client.post(f"/api/wishlist/{seed_catalog['product'].id}", headers=headers)

    small.price = 75
    small.compare_at_price = 150
    db.commit()

    item = client.get("/api/wishlist", headers=headers).json()["items"][0]
    assert item["price"] == 75
    assert item["compare_at_price"] == 150
    assert item["discount_percent"] == 50


def test_wishlists_are_per_customer(client, customer, seed_catalog, db):
    mine = login(client, customer)
    theirs = _register(client, "other@test.dev", "Other Person")
    product = seed_catalog["product"]
    client.post(f"/api/wishlist/{product.id}", headers=mine)

    assert client.get("/api/wishlist/ids", headers=theirs).json()["ids"] == []
    assert client.get("/api/wishlist", headers=theirs).json()["total"] == 0

    # They cannot unsave something that is not theirs.
    client.delete(f"/api/wishlist/{product.id}", headers=theirs)
    assert client.get("/api/wishlist/ids", headers=mine).json()["ids"] == [product.id]
