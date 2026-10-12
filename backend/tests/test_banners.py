"""Promotional banners: payloads per placement, admin rules, analytics, uploads.

Four layers, because each can break alone:
  * the public contract — active/in-window only, priority order, the
    per-placement caps (five hero slides, one creative anywhere else),
    category filtering and href resolution;
  * the admin surface — CRUD with the business rules (category pairing,
    window order, hero cap, link targets), status chips, list
    pagination/filter/sort, drag-to-reorder;
  * the analytics inbox — batched events, per-client impression dedup,
    rate limiting, and the Celery flush that finally reaches Postgres;
  * uploads — type/size validation, resized desktop+mobile variants served
    from /api/media with immutable caching and no path traversal.
"""

import io
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from tests.conftest import login

IMAGE = "/api/img/placeholder.svg?text=Banner"


def _payload(**overrides) -> dict:
    spec = dict(
        title="Test promo",
        image_desktop=IMAGE,
        placement="home_mid_strip",
        link_type="url",
        link_target="/products",
        is_active=True,
        priority=10,
    )
    spec.update(overrides)
    return spec


def _banner(db, **overrides):
    """Insert a banner straight from a test (bypassing the admin API)."""
    from app.modules.banners.models import Banner, BannerLinkType, BannerPlacement
    from app.modules.banners.service import invalidate_banners_cache

    spec = _payload(**overrides)
    spec["placement"] = BannerPlacement(spec["placement"])
    spec["link_type"] = BannerLinkType(spec["link_type"])
    banner = Banner(**spec)
    db.add(banner)
    db.commit()
    db.refresh(banner)
    # Direct writes skip the admin service, so drop the payload cache here
    # or a warm [] would hide the new row.
    invalidate_banners_cache()
    return banner


def _create(client, headers, **overrides) -> dict:
    res = client.post("/api/admin/banners", json=_payload(**overrides), headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


# ── Public payloads ──────────────────────────────────────────────────────


def test_public_empty_placement_returns_empty(client):
    res = client.get("/api/banners", params={"placement": "home_hero"})
    assert res.status_code == 200
    assert res.json() == []


def test_public_orders_by_priority_and_caps_hero_at_five(client, db):
    for priority in (60, 50, 40, 30, 20, 10):
        _banner(db, title=f"Hero {priority}", placement="home_hero", priority=priority)

    res = client.get("/api/banners", params={"placement": "home_hero"})
    items = res.json()
    assert len(items) == 5  # the carousel holds five slides, max
    assert [item["title"] for item in items] == [
        "Hero 10", "Hero 20", "Hero 30", "Hero 40", "Hero 50",
    ]


def test_public_mid_strip_holds_one_creative(client, db):
    _banner(db, title="Strip A", priority=10)
    _banner(db, title="Strip B", priority=20)

    items = client.get("/api/banners", params={"placement": "home_mid_strip"}).json()
    assert [item["title"] for item in items] == ["Strip A"]


def test_public_hides_scheduled_expired_and_inactive(client, db):
    now = datetime.now(UTC)
    _banner(
        db,
        title="Soon",
        placement="home_hero",
        starts_at=now + timedelta(days=2),
    )
    _banner(db, title="Over", placement="home_hero", ends_at=now - timedelta(hours=1))
    _banner(db, title="Off", placement="home_hero", is_active=False)

    items = client.get("/api/banners", params={"placement": "home_hero"}).json()
    assert items == []

    # …and the live one still shows (window ends are inclusive-exclusive).
    _banner(db, title="Now", placement="home_hero", priority=1)
    items = client.get("/api/banners", params={"placement": "home_hero"}).json()
    assert [item["title"] for item in items] == ["Now"]


def test_public_category_header_needs_matching_category(client, db, seed_catalog):
    category = seed_catalog["category"]  # slug: pantry
    _banner(
        db,
        title="Pantry header",
        placement="category_header",
        category_id=category.id,
        link_type="category",
        link_target="pantry",
    )

    res = client.get(
        "/api/banners", params={"placement": "category_header", "category": "pantry"}
    )
    assert [item["title"] for item in res.json()] == ["Pantry header"]

    other = client.get(
        "/api/banners", params={"placement": "category_header", "category": "drinks"}
    )
    assert other.json() == []
    # A category header without a category shows nothing at all.
    assert client.get("/api/banners", params={"placement": "category_header"}).json() == []


def test_public_resolves_hrefs(client, db, seed_catalog):
    from app.modules.discounts.models import Coupon, CouponKind

    db.add(
        Coupon(
            code="FREESHIP",
            kind=CouponKind.FREE_DELIVERY,
            value=Decimal("0"),
            min_subtotal=Decimal("0"),
            is_active=True,
        )
    )
    db.commit()

    product = seed_catalog["product"]  # slug: test-oats
    category = seed_catalog["category"]  # slug: pantry

    _banner(db, title="To product", placement="home_hero",
            link_type="product", link_target=product.slug, priority=10)
    _banner(db, title="To category", placement="home_hero",
            link_type="category", link_target=category.slug, priority=20)
    _banner(db, title="To coupon", placement="cart_promo",
            link_type="coupon", link_target="freeship", priority=30)
    _banner(db, title="To url", placement="home_mid_strip",
            link_type="url", link_target="/products?sort=newest", priority=40)

    hero = {
        item["title"]: item["href"]
        for item in client.get("/api/banners", params={"placement": "home_hero"}).json()
    }
    assert hero["To product"] == "/p/test-oats"
    assert hero["To category"] == "/products?category=pantry"

    cart = client.get("/api/banners", params={"placement": "cart_promo"}).json()
    assert cart[0]["href"] == "/cart?coupon=FREESHIP"

    strip = client.get("/api/banners", params={"placement": "home_mid_strip"}).json()
    assert strip[0]["href"] == "/products?sort=newest"


def test_public_dead_link_degrades_to_catalogue(client, db):
    _banner(db, placement="home_hero", link_type="product", link_target="ghost-slug")
    items = client.get("/api/banners", params={"placement": "home_hero"}).json()
    assert items[0]["href"] == "/products"


def test_public_cache_invalidated_by_admin_create(client, db, admin_user):
    assert client.get("/api/banners", params={"placement": "home_mid_strip"}).json() == []

    headers = login(client, admin_user)
    _create(client, headers, title="Warmed into view")

    # Without invalidation the warm [] would outlive the create for 60s.
    items = client.get("/api/banners", params={"placement": "home_mid_strip"}).json()
    assert [item["title"] for item in items] == ["Warmed into view"]


# ── Admin: auth, CRUD, rules ─────────────────────────────────────────────


def test_admin_requires_staff(client, customer, admin_user, db):
    assert client.get("/api/admin/banners").status_code == 401

    customer_headers = login(client, customer)
    assert client.get("/api/admin/banners", headers=customer_headers).status_code == 403

    admin_headers = login(client, admin_user)
    assert client.get("/api/admin/banners", headers=admin_headers).status_code == 200


def test_admin_create_update_delete(client, admin_user, db):
    headers = login(client, admin_user)

    created = _create(client, headers, title="Launch banner")
    banner_id = created["id"]
    assert created["status"] == "active"
    assert created["impressions"] == 0

    res = client.patch(
        f"/api/admin/banners/{banner_id}",
        json=_payload(title="Launch banner v2", priority=42),
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["title"] == "Launch banner v2"
    assert res.json()["priority"] == 42

    assert client.delete(f"/api/admin/banners/{banner_id}", headers=headers).status_code == 204
    assert client.get(
        f"/api/admin/banners/{banner_id}", headers=headers
    ).status_code in (404, 405)  # no detail route: list simply drops it
    assert all(
        item["id"] != banner_id
        for item in client.get("/api/admin/banners", headers=headers).json()["items"]
    )


def test_admin_list_pagination_filter_sort(client, admin_user):
    headers = login(client, admin_user)
    _create(client, headers, title="Alpha", placement="home_hero", priority=10)
    _create(client, headers, title="Bravo", placement="home_hero", priority=20)
    _create(client, headers, title="Charlie", placement="home_mid_strip", priority=30)
    _create(client, headers, title="Delta", placement="cart_promo", is_active=False)
    _create(
        client,
        headers,
        title="Echo",
        placement="home_hero",
        starts_at=(datetime.now(UTC) + timedelta(days=2)).isoformat(),
    )

    page1 = client.get(
        "/api/admin/banners", params={"page": 1, "page_size": 2}, headers=headers
    ).json()
    assert page1["total"] == 5 and page1["pages"] == 3 and len(page1["items"]) == 2

    heroes = client.get(
        "/api/admin/banners", params={"placement": "home_hero"}, headers=headers
    ).json()
    assert heroes["total"] == 3

    inactive = client.get(
        "/api/admin/banners", params={"status": "inactive"}, headers=headers
    ).json()
    assert [item["title"] for item in inactive["items"]] == ["Delta"]

    scheduled = client.get(
        "/api/admin/banners", params={"status": "scheduled"}, headers=headers
    ).json()
    assert [item["title"] for item in scheduled["items"]] == ["Echo"]

    active = client.get(
        "/api/admin/banners", params={"status": "active"}, headers=headers
    ).json()
    assert {item["title"] for item in active["items"]} == {"Alpha", "Bravo", "Charlie"}

    by_title = client.get(
        "/api/admin/banners", params={"sort": "title"}, headers=headers
    ).json()
    assert [item["title"] for item in by_title["items"]] == [
        "Alpha", "Bravo", "Charlie", "Delta", "Echo",
    ]

    searched = client.get(
        "/api/admin/banners", params={"q": "cha"}, headers=headers
    ).json()
    assert [item["title"] for item in searched["items"]] == ["Charlie"]


def test_admin_status_chips(client, admin_user):
    headers = login(client, admin_user)
    now = datetime.now(UTC)
    _create(client, headers, title="Live one", placement="cart_promo")
    _create(
        client,
        headers,
        title="Future one",
        placement="cart_promo",
        starts_at=(now + timedelta(days=1)).isoformat(),
    )
    _create(
        client,
        headers,
        title="Past one",
        placement="cart_promo",
        ends_at=(now - timedelta(days=1)).isoformat(),
    )
    _create(client, headers, title="Paused one", placement="cart_promo", is_active=False)

    items = client.get("/api/admin/banners", headers=headers).json()["items"]
    status = {item["title"]: item["status"] for item in items}
    assert status == {
        "Live one": "active",
        "Future one": "scheduled",
        "Past one": "expired",
        "Paused one": "inactive",
    }


def test_admin_create_validates_category_pairing(client, admin_user, seed_catalog):
    headers = login(client, admin_user)
    category_id = seed_catalog["category"].id

    res = client.post(
        "/api/admin/banners",
        json=_payload(placement="category_header", category_id=None),
        headers=headers,
    )
    assert res.status_code == 400
    assert res.json()["error"]["details"][0]["field"] == "category_id"

    res = client.post(
        "/api/admin/banners",
        json=_payload(placement="cart_promo", category_id=category_id),
        headers=headers,
    )
    assert res.status_code == 400

    ok = client.post(
        "/api/admin/banners",
        json=_payload(
            placement="category_header",
            category_id=category_id,
            link_type="category",
            link_target="pantry",
        ),
        headers=headers,
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["category_name"] == "Pantry"


def test_admin_create_validates_window(client, admin_user):
    headers = login(client, admin_user)
    now = datetime.now(UTC)
    res = client.post(
        "/api/admin/banners",
        json=_payload(
            starts_at=(now + timedelta(days=2)).isoformat(),
            ends_at=(now + timedelta(days=1)).isoformat(),
        ),
        headers=headers,
    )
    assert res.status_code == 400
    assert res.json()["error"]["details"][0]["field"] == "ends_at"


def test_admin_hero_cap_enforced(client, admin_user):
    headers = login(client, admin_user)
    for index in range(5):
        _create(client, headers, title=f"Hero {index}", placement="home_hero")

    res = client.post(
        "/api/admin/banners", json=_payload(title="Hero overflow", placement="home_hero"),
        headers=headers,
    )
    assert res.status_code == 409

    # Pausing one makes room again.
    items = client.get(
        "/api/admin/banners", params={"placement": "home_hero"}, headers=headers
    ).json()["items"]
    paused = client.patch(
        f"/api/admin/banners/{items[0]['id']}",
        json=_payload(title=items[0]["title"], placement="home_hero", is_active=False),
        headers=headers,
    )
    assert paused.status_code == 200
    retry = client.post(
        "/api/admin/banners", json=_payload(title="Hero overflow", placement="home_hero"),
        headers=headers,
    )
    assert retry.status_code == 201


def test_admin_validates_link_targets(client, admin_user, seed_catalog):
    headers = login(client, admin_user)

    res = client.post(
        "/api/admin/banners",
        json=_payload(link_type="product", link_target="ghost"),
        headers=headers,
    )
    assert res.status_code == 400
    assert res.json()["error"]["details"][0]["field"] == "link_target"

    res = client.post(
        "/api/admin/banners",
        json=_payload(link_type="url", link_target="not-a-link"),
        headers=headers,
    )
    assert res.status_code == 400

    res = client.post(
        "/api/admin/banners",
        json=_payload(image_desktop="ftp://example/hero.png"),
        headers=headers,
    )
    assert res.status_code == 400
    assert res.json()["error"]["details"][0]["field"] == "image_desktop"

    ok = client.post(
        "/api/admin/banners",
        json=_payload(link_type="product", link_target=seed_catalog["product"].slug),
        headers=headers,
    )
    assert ok.status_code == 201, ok.text


def test_admin_reorder(client, admin_user):
    headers = login(client, admin_user)
    a = _create(client, headers, title="First", placement="cart_promo")
    b = _create(client, headers, title="Second", placement="cart_promo")
    c = _create(client, headers, title="Third", placement="cart_promo")

    res = client.patch(
        "/api/admin/banners/reorder",
        json={"ids": [c["id"], b["id"], a["id"]]},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    ordered = res.json()
    assert [item["id"] for item in ordered] == [c["id"], b["id"], a["id"]]
    assert [item["priority"] for item in ordered] == [10, 20, 30]

    # The public payload follows the new order (highest priority first).
    strip = client.get("/api/banners", params={"placement": "cart_promo"}).json()
    assert strip[0]["title"] == "Third"

    missing = client.patch(
        "/api/admin/banners/reorder", json={"ids": [999_999]}, headers=headers
    )
    assert missing.status_code == 404


# ── Analytics inbox ──────────────────────────────────────────────────────


def test_track_buffers_then_flushes_to_db(client, db, admin_user):
    from app.core.celery_app import celery
    from app.modules.banners.service import flush_stats
    from app.modules.banners.tasks import flush_banner_stats

    banner = _banner(db)

    res = client.post(
        "/api/banners/track",
        json={
            "events": [
                {"id": banner.id, "type": "impression"},
                {"id": banner.id, "type": "click"},
            ]
        },
    )
    assert res.status_code == 200 and res.json()["accepted"] == 2

    # The admin list shows live numbers before anything hits Postgres…
    headers = login(client, admin_user)
    row = client.get("/api/admin/banners", headers=headers).json()["items"][0]
    assert row["impressions"] == 1 and row["clicks"] == 1 and row["ctr"] == 100.0

    # …and the beat task is the thing that persists them.
    assert celery.conf.beat_schedule["flush-banner-stats"]["task"] == "banners.flush_stats"
    assert flush_banner_stats.__name__ == "flush_banner_stats"

    assert flush_stats(db) == 1
    db.refresh(banner)
    assert banner.impressions == 1 and banner.clicks == 1

    # Buffer drained: a second flush changes nothing.
    assert flush_stats(db) == 0
    db.refresh(banner)
    assert banner.impressions == 1

    row = client.get("/api/admin/banners", headers=headers).json()["items"][0]
    assert row["impressions"] == 1 and row["clicks"] == 1


def test_track_dedupes_impressions_per_client(client, db):
    banner = _banner(db)
    event = {"events": [{"id": banner.id, "type": "impression"}]}

    first = client.post("/api/banners/track", json=event)
    second = client.post("/api/banners/track", json=event)
    assert first.json()["accepted"] == 1
    assert second.json()["accepted"] == 0  # same client, same banner, 30 min window

    # Clicks are intentional and never deduped.
    click = {"events": [{"id": banner.id, "type": "click"}]}
    assert client.post("/api/banners/track", json=click).json()["accepted"] == 1
    assert client.post("/api/banners/track", json=click).json()["accepted"] == 1


def test_track_ignores_unknown_banner_ids(client, db):
    res = client.post(
        "/api/banners/track", json={"events": [{"id": 999_999, "type": "impression"}]}
    )
    assert res.status_code == 200 and res.json()["accepted"] == 0


def test_track_rate_limit_returns_429(client, db):
    _banner(db)
    batch = [{"id": 1, "type": "impression"}] * 50

    assert client.post("/api/banners/track", json={"events": batch}).status_code == 200
    assert client.post("/api/banners/track", json={"events": batch}).status_code == 200
    res = client.post("/api/banners/track", json={"events": batch})  # 150 > 120/min
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "rate_limited"


def test_flush_after_delete_is_harmless(client, db):
    from app.modules.banners.service import flush_stats

    banner = _banner(db)
    client.post(
        "/api/banners/track", json={"events": [{"id": banner.id, "type": "click"}]}
    )
    db.delete(banner)
    db.commit()

    assert flush_stats(db) == 0  # counters dropped with the row, no error


# ── Uploads ──────────────────────────────────────────────────────────────


def test_upload_rejects_wrong_type_and_oversize(client, admin_user):
    headers = login(client, admin_user)

    text = client.post(
        "/api/admin/banners/upload",
        files={"file": ("note.txt", b"not an image", "text/plain")},
        headers=headers,
    )
    assert text.status_code == 400
    assert "JPEG" in text.json()["error"]["message"]

    huge = client.post(
        "/api/admin/banners/upload",
        files={"file": ("huge.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")},
        headers=headers,
    )
    assert huge.status_code == 400
    assert "MB" in huge.json()["error"]["message"]


def test_upload_resizes_and_serves(client, admin_user):
    from PIL import Image

    headers = login(client, admin_user)
    buf = io.BytesIO()
    Image.new("RGB", (2000, 1000), (31, 61, 43)).save(buf, format="PNG")

    res = client.post(
        "/api/admin/banners/upload",
        files={"file": ("hero.png", buf.getvalue(), "image/png")},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    desktop_url = res.json()["image_desktop"]
    mobile_url = res.json()["image_mobile"]
    assert desktop_url.startswith("/api/media/banners/")
    assert desktop_url.endswith("_desktop.webp")
    assert mobile_url.endswith("_mobile.webp")

    # settings.media_root is the source of truth _store() writes to —
    # os.environ can diverge when conftest executes twice in one process.
    from app.core.config import settings

    root = Path(settings.media_root)
    desktop = root / desktop_url.split("/api/media/", 1)[1]
    mobile = root / mobile_url.split("/api/media/", 1)[1]
    assert desktop.is_file() and mobile.is_file()
    with Image.open(desktop) as img:
        assert img.format == "WEBP" and img.width == 1600
    with Image.open(mobile) as img:
        assert img.format == "WEBP" and img.width == 750

    served = client.get(desktop_url)
    assert served.status_code == 200
    assert "immutable" in served.headers["cache-control"]

    missing = client.get("/api/media/banners/nope.webp")
    assert missing.status_code == 404
    traversal = client.get("/api/media/..%2f..%2fconftest.py")
    assert traversal.status_code == 404


def test_upload_requires_staff(client, customer):
    headers = login(client, customer)
    res = client.post(
        "/api/admin/banners/upload",
        files={"file": ("hero.png", b"x", "image/png")},
        headers=headers,
    )
    assert res.status_code == 403


# ── Seed ─────────────────────────────────────────────────────────────────


def test_seed_demo_banners_idempotent(db):
    from sqlalchemy import func, select

    from app.modules.banners.models import Banner, BannerPlacement
    from app.modules.catalog.models import Category
    from app.seed import ensure_demo_banners

    db.add(Category(name="Fresh Produce", slug="fresh-produce"))
    db.commit()

    ensure_demo_banners(db)
    ensure_demo_banners(db)

    heroes = db.scalars(
        select(Banner).where(Banner.placement == BannerPlacement.HOME_HERO)
    ).all()
    assert len(heroes) == 3  # the carousel ships with three slides
    total = db.scalar(select(func.count()).select_from(Banner))
    assert total == 6  # 3 hero + mid strip + category header + cart promo

    # A hand-edited banner survives a re-seed.
    strip = db.scalars(
        select(Banner).where(Banner.placement == BannerPlacement.HOME_MID_STRIP)
    ).one()
    strip.subtitle = "Edited by hand"
    db.commit()

    ensure_demo_banners(db)
    db.refresh(strip)
    assert strip.subtitle == "Edited by hand"
    assert db.scalar(select(func.count()).select_from(Banner)) == 6
