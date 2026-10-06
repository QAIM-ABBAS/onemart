"""Reports dashboard: SQL aggregates, previous-period deltas, dense series,
category roll-up, low-stock thresholds, CSV export, and the 60s cache."""

import csv
import io
from datetime import UTC, datetime, timedelta

from sqlalchemy import update

from app.modules.orders.models import Order, OrderStatus
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


def _place(client, email: str, variant_id: int = 2, quantity: int = 1) -> dict:
    headers = login(client, email)
    client.post(
        "/api/cart/items", json={"variant_id": variant_id, "quantity": quantity}, headers=headers
    )
    response = client.post("/api/checkout", json={"address": ADDRESS}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def _set_placed(db, order_number: str, when: datetime) -> None:
    db.execute(update(Order).where(Order.order_number == order_number).values(placed_at=when))
    db.commit()


def _set_status(db, order_number: str, status: OrderStatus) -> None:
    db.execute(update(Order).where(Order.order_number == order_number).values(status=status))
    db.commit()


def _overview(client, headers: dict, **params) -> dict:
    response = client.get("/api/admin/reports/overview", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _approx(value: float) -> float:
    return round(float(value), 2)


def test_reports_require_staff(client, customer):
    headers = login(client, customer)
    response = client.get("/api/admin/reports/overview", headers=headers)
    assert response.status_code == 403

    csv_response = client.get("/api/admin/reports/orders.csv", headers=headers)
    assert csv_response.status_code == 403


def test_kpis_compare_against_the_previous_window(client, db, admin_user, customer, seed_catalog):
    headers = login(client, admin_user)
    today = datetime.now(UTC).date()
    start = today - timedelta(days=6)

    # Current window: one live order + one cancelled today. Previous window
    # (the seven days before, [today-13, today-6)): one delivered order.
    live = _place(client, customer, variant_id=2, quantity=2)  # 2 x 180 = 360 + 40 delivery
    cancelled = _place(client, customer, variant_id=1, quantity=1)  # 100 + 40 (the small runs dry)
    old = _place(client, customer, variant_id=2, quantity=3)  # 540 + 40 = 580
    _set_status(db, cancelled["order_number"], OrderStatus.CANCELLED)
    _set_placed(
        db,
        old["order_number"],
        datetime.combine(today - timedelta(days=8), datetime.min.time(), tzinfo=UTC)
        .replace(hour=11),
    )

    data = _overview(
        client,
        headers,
        range="custom",
        start=start.isoformat(),
        end=today.isoformat(),
    )

    # Revenue excludes the cancellation; the orders KPI counts it.
    assert _approx(data["kpis"]["revenue"]["current"]) == 400.0
    assert _approx(data["kpis"]["revenue"]["previous"]) == 580.0
    expected_delta = round((400.0 - 580.0) / 580.0 * 100, 1)
    assert data["kpis"]["revenue"]["delta_pct"] == expected_delta

    assert data["kpis"]["orders"]["current"] == 2
    assert data["kpis"]["orders"]["previous"] == 1
    assert data["kpis"]["orders"]["delta_pct"] == 100.0

    # AOV: revenue over non-cancelled orders only (one in each window here).
    assert _approx(data["kpis"]["avg_order_value"]["current"]) == 400.0
    assert _approx(data["kpis"]["avg_order_value"]["previous"]) == 580.0

    # The customer fixture signed up inside the current window; the admin is
    # role-filtered out and nobody signed up in the previous one — so the
    # ratio is undefined and the API says so instead of inventing a percent.
    assert data["kpis"]["new_customers"]["current"] == 1
    assert data["kpis"]["new_customers"]["previous"] == 0
    assert data["kpis"]["new_customers"]["delta_pct"] is None

    # The window echo drives the chart axis + "vs previous" labels.
    parsed = {key: datetime.fromisoformat(data["range"][key]) for key in ("start", "end")}
    assert parsed["start"] == datetime.combine(start, datetime.min.time(), tzinfo=UTC)
    assert parsed["end"] == datetime.combine(
        today + timedelta(days=1), datetime.min.time(), tzinfo=UTC
    )
    assert data["range"]["bucket"] == "day"

    # Recent orders inside the window, newest first.
    recent = [row["order_number"] for row in data["recent_orders"]]
    assert recent[0] in {live["order_number"], cancelled["order_number"]}
    assert old["order_number"] not in recent


def test_series_is_dense_and_agrees_with_the_kpis(
    client, db, admin_user, customer, seed_catalog
):
    headers = login(client, admin_user)
    today = datetime.now(UTC).date()
    start = today - timedelta(days=6)

    order = _place(client, customer)  # pending, placed now
    data = _overview(
        client,
        headers,
        range="custom",
        start=start.isoformat(),
        end=today.isoformat(),
    )

    series = data["revenue_series"]
    assert len(series) == 7  # quiet days are zero points, not holes
    assert series[0]["orders"] == 0
    assert series[0]["revenue"] == 0
    assert series[6]["orders"] == 1  # the last bucket is today

    # The series is the same aggregate as the KPI, just bucketed.
    assert sum(point["orders"] for point in series) == data["kpis"]["orders"]["current"]
    assert (
        _approx(sum(point["revenue"] for point in series))
        == _approx(data["kpis"]["revenue"]["current"])
    )

    breakdown = {row["status"]: row["orders"] for row in data["status_breakdown"]}
    assert breakdown == {"pending": 1}

    # "Today" switches the axis to hourly buckets (24 of them).
    hourly = _overview(client, headers, range="today")
    assert hourly["range"]["bucket"] == "hour"
    assert len(hourly["revenue_series"]) == 24
    assert sum(point["orders"] for point in hourly["revenue_series"]) >= 1
    assert hourly["recent_orders"][0]["order_number"] == order["order_number"]


def test_top_products_and_category_rollup(client, db, admin_user, customer, seed_catalog):
    from app.modules.catalog.models import Category, Product, ProductVariant
    from app.modules.inventory.models import Inventory

    headers = login(client, admin_user)

    # A second department with a subcategory: sales must roll up to the root
    # ("Drinks"), not fragment under "Cola".
    drinks = Category(name="Drinks", slug="drinks")
    db.add(drinks)
    db.flush()
    cola = Category(name="Cola", slug="cola", parent_id=drinks.id)
    db.add(cola)
    db.flush()
    product = Product(
        name="Cola 1L",
        slug="cola-1l",
        category_id=cola.id,
        description="Fizzy",
        is_active=True,
    )
    db.add(product)
    db.flush()
    variant = ProductVariant(
        product_id=product.id, sku="COLA-1L", name="1 L", price=50, is_default=True
    )
    db.add(variant)
    db.flush()
    db.add(Inventory(variant_id=variant.id, quantity=100))
    db.commit()

    _place(client, customer, variant_id=2, quantity=3)  # Test Oats 1 kg: 3 x 180
    _place(client, customer, variant_id=variant.id, quantity=2)  # Cola: 2 x 50

    data = _overview(client, headers, range="7d")

    top = data["top_products"]
    assert [row["product_name"] for row in top] == ["Test Oats", "Cola 1L"]
    assert top[0]["revenue"] == 540.0 and top[0]["units"] == 3 and top[0]["orders"] == 1
    assert top[1]["revenue"] == 100.0 and top[1]["units"] == 2

    sales = {row["name"]: row for row in data["category_sales"]}
    assert sales["Drinks"]["revenue"] == 100.0  # child "Cola" folded into root
    assert sales["Pantry"]["revenue"] == 540.0
    assert "Cola" not in sales


def test_low_stock_thresholds(client, admin_user, seed_catalog):
    headers = login(client, admin_user)
    # seed_catalog: OAT-500 has 1 unit, OAT-1000 has 10, both at threshold 5.

    default = _overview(client, headers, range="7d")
    rows = {row["sku"]: row for row in default["low_stock"]}
    assert rows["OAT-500"]["available"] == 1
    assert rows["OAT-500"]["threshold"] == 5
    assert "OAT-1000" not in rows

    # A dashboard-wide override beats the per-variant threshold...
    override = _overview(client, headers, range="7d", threshold=20)
    assert {row["sku"] for row in override["low_stock"]} == {"OAT-500", "OAT-1000"}
    assert all(row["threshold"] == 20 for row in override["low_stock"])

    # ...and a stricter one finds nothing.
    strict = _overview(client, headers, range="7d", threshold=0)
    assert strict["low_stock"] == []


def test_recent_activity_lists_staff_actions(client, db, admin_user, customer, seed_catalog):
    admin_headers = login(client, admin_user)
    order = _place(client, customer)
    status = client.patch(
        f"/api/admin/orders/{order['id']}/status",
        json={"status": "confirmed", "note": "On it"},
        headers=admin_headers,
    )
    assert status.status_code == 200, status.text

    data = _overview(client, admin_headers, range="today")
    actions = [row["action"] for row in data["recent_activity"]]
    assert "order.status_change" in actions
    entry = next(row for row in data["recent_activity"] if row["action"] == "order.status_change")
    assert entry["entity"] == "order"
    assert entry["actor"] == admin_user


def test_orders_csv_export(client, db, admin_user, customer, seed_catalog):
    headers = login(client, admin_user)
    order = _place(client, customer)
    today = datetime.now(UTC).date()

    response = client.get(
        "/api/admin/reports/orders.csv",
        params={
            "range": "custom",
            "start": today.isoformat(),
            "end": today.isoformat(),
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment; filename=" in response.headers["content-disposition"]

    rows = list(csv.reader(io.StringIO(response.text)))
    assert rows[0][:4] == ["order_number", "placed_at", "status", "payment_method"]
    body = [row for row in rows[1:] if row]
    assert len(body) == 1
    assert body[0][0] == order["order_number"]
    assert body[0][2] == "pending"
    assert len(body[0]) == len(rows[0])

    # A window without orders: header only.
    older = client.get(
        "/api/admin/reports/orders.csv",
        params={
            "range": "custom",
            "start": (today - timedelta(days=30)).isoformat(),
            "end": (today - timedelta(days=7)).isoformat(),
        },
        headers=headers,
    )
    assert older.status_code == 200
    assert len([r for r in csv.reader(io.StringIO(older.text)) if r]) == 1


def test_overview_serves_from_cache_until_invalidated(
    client, db, admin_user, customer, seed_catalog
):
    from app.modules.reports.service import invalidate_report_cache

    headers = login(client, admin_user)
    today = datetime.now(UTC).date()
    params = {"range": "custom", "start": today.isoformat(), "end": today.isoformat()}

    _place(client, customer)
    first = _overview(client, headers, **params)
    assert first["kpis"]["orders"]["current"] == 1

    # Another order lands, but the 60s payload must still answer...
    _place(client, customer, variant_id=1, quantity=1)
    cached = _overview(client, headers, **params)
    assert cached["kpis"]["orders"]["current"] == 1
    assert cached["generated_at"] == first["generated_at"]

    # ...until the cache drops (what happens after the TTL).
    invalidate_report_cache()
    fresh = _overview(client, headers, **params)
    assert fresh["kpis"]["orders"]["current"] == 2


def test_invalid_ranges_are_rejected(client, admin_user):
    headers = login(client, admin_user)

    missing = client.get(
        "/api/admin/reports/overview", params={"range": "custom"}, headers=headers
    )
    assert missing.status_code == 400
    assert "start" in missing.json()["error"]["message"].lower()

    backwards = client.get(
        "/api/admin/reports/overview",
        params={"range": "custom", "start": "2026-10-05", "end": "2026-10-01"},
        headers=headers,
    )
    assert backwards.status_code == 400

    unknown = client.get(
        "/api/admin/reports/overview", params={"range": "14d"}, headers=headers
    )
    assert unknown.status_code == 422

    negative = client.get(
        "/api/admin/reports/overview", params={"range": "7d", "threshold": -1},
        headers=headers,
    )
    assert negative.status_code == 422
