"""Aggregates for the admin reports dashboard.

House rules:
  · every number comes out of SQL (GROUP BY / count / sum FILTER) — nothing
    is summed in Python;
  · windows are half-open [start, end) in UTC; the "previous" window for the
    deltas is the same length immediately before the selected one;
  · the whole overview is one payload, cached under a key derived from the
    resolved window for REPORT_CACHE_TTL seconds — a narrow TTL, because the
    data underneath keeps moving (TTL is the only invalidation needed: the
    dashboard reads, nothing here writes).
"""

from __future__ import annotations

import csv
import io
import json
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.redis import cache_delete_prefix, cache_get, cache_set
from app.modules.audit.models import AuditLog
from app.modules.catalog.models import Product, ProductVariant
from app.modules.inventory.models import Inventory
from app.modules.orders.models import Order, OrderItem, OrderStatus
from app.modules.users.models import User, UserRole

REPORT_CACHE_TTL = 60
REPORT_CACHE_PREFIX = "report:"
MAX_CUSTOM_DAYS = 366
TOP_PRODUCTS_LIMIT = 10
LOW_STOCK_LIMIT = 25
RECENT_LIMIT = 8


def _utc_day(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=UTC)


def window_for(kind: str, start_date: date | None, end_date: date | None) -> tuple[datetime, datetime]:
    """Resolve a range preset (or custom dates) into a half-open UTC window."""
    today = datetime.now(UTC).date()
    if kind == "today":
        return _utc_day(today), _utc_day(today + timedelta(days=1))
    if kind == "7d":
        return _utc_day(today - timedelta(days=6)), _utc_day(today + timedelta(days=1))
    if kind == "30d":
        return _utc_day(today - timedelta(days=29)), _utc_day(today + timedelta(days=1))
    if kind == "custom":
        if start_date is None or end_date is None:
            raise AppError(
                "A custom range needs both a start and an end date",
                details={"field": "range"},
            )
        if start_date > end_date:
            raise AppError(
                "The start date must be on or before the end date",
                details={"field": "start"},
            )
        if (end_date - start_date).days >= MAX_CUSTOM_DAYS:
            raise AppError(
                f"A custom range cannot span more than {MAX_CUSTOM_DAYS} days",
                details={"field": "end"},
            )
        # end is inclusive as a date, exclusive as a timestamp: +1 day covers it.
        return _utc_day(start_date), _utc_day(end_date + timedelta(days=1))
    raise AppError(f"Unknown range: {kind}", details={"field": "range"})


def _pct(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


def _metric(current: float, previous: float) -> dict:
    return {"current": current, "previous": previous, "delta_pct": _pct(current, previous)}


def _order_totals(db: Session, start: datetime, end: datetime) -> dict:
    """One aggregate row: gross revenue (cancellations excluded), orders
    placed (cancellations included), and the non-cancelled count that the
    average order value divides by."""
    revenue, orders, valid = db.execute(
        select(
            func.coalesce(
                func.sum(Order.total).filter(Order.status != OrderStatus.CANCELLED), 0
            ),
            func.count(Order.id),
            func.count(Order.id).filter(Order.status != OrderStatus.CANCELLED),
        ).where(Order.placed_at >= start, Order.placed_at < end)
    ).one()
    valid = int(valid)
    revenue = float(revenue)
    return {
        "revenue": revenue,
        "orders": int(orders),
        "avg": revenue / valid if valid else 0.0,
    }


def _new_customers(db: Session, start: datetime, end: datetime) -> int:
    return int(
        db.execute(
            select(func.count(User.id)).where(
                User.created_at >= start,
                User.created_at < end,
                User.role == UserRole.CUSTOMER,
            )
        ).scalar_one()
    )


# Densely filled with generate_series, so a quiet day is a zero point instead
# of a hole. Truncation happens AT TIME ZONE 'UTC' on both sides of the join:
# date_trunc on a timestamptz alone would use the session time zone and the
# generated buckets (UTC midnights) would never match.
_SERIES_SQL = text(
    """
    WITH buckets AS (
        SELECT generate_series(
            CAST(:start AS timestamptz) AT TIME ZONE 'UTC',
            (CAST(:end AS timestamptz) - CAST(:step AS interval)) AT TIME ZONE 'UTC',
            CAST(:step AS interval)
        ) AS bucket
    ),
    agg AS (
        SELECT date_trunc(:unit, o.placed_at AT TIME ZONE 'UTC') AS bucket,
               COUNT(*) AS orders,
               COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled'), 0) AS revenue
        FROM orders o
        WHERE o.placed_at >= CAST(:start AS timestamptz)
          AND o.placed_at < CAST(:end AS timestamptz)
        GROUP BY 1
    )
    SELECT b.bucket,
           COALESCE(a.orders, 0) AS orders,
           COALESCE(a.revenue, 0) AS revenue
    FROM buckets b
    LEFT JOIN agg a ON a.bucket = b.bucket
    ORDER BY b.bucket
    """
)


def _series(db: Session, start: datetime, end: datetime, bucket: str) -> list[dict]:
    step, unit = ("1 hour", "hour") if bucket == "hour" else ("1 day", "day")
    rows = db.execute(
        _SERIES_SQL.bindparams(start=start, end=end, step=step, unit=unit)
    ).all()
    return [
        {
            # psycopg returns naive timestamps for `timestamp` columns; they
            # were truncated in UTC, so put the zone back on.
            "bucket": row.bucket.replace(tzinfo=UTC)
            if row.bucket.tzinfo is None
            else row.bucket,
            "revenue": float(row.revenue),
            "orders": int(row.orders),
        }
        for row in rows
    ]


def _status_breakdown(db: Session, start: datetime, end: datetime) -> list[dict]:
    rows = db.execute(
        select(
            Order.status,
            func.count(Order.id),
            func.coalesce(func.sum(Order.total), 0),
        )
        .where(Order.placed_at >= start, Order.placed_at < end)
        .group_by(Order.status)
        .order_by(func.count(Order.id).desc(), Order.status)
    ).all()
    return [
        {"status": status, "orders": int(orders), "revenue": float(revenue)}
        for status, orders, revenue in rows
    ]


def _top_products(db: Session, start: datetime, end: datetime) -> list[dict]:
    rows = db.execute(
        select(
            OrderItem.product_id,
            OrderItem.product_name,
            func.sum(OrderItem.quantity),
            func.coalesce(func.sum(OrderItem.line_total), 0),
            func.count(func.distinct(OrderItem.order_id)),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.placed_at >= start,
            Order.placed_at < end,
            Order.status != OrderStatus.CANCELLED,
        )
        .group_by(OrderItem.product_id, OrderItem.product_name)
        .order_by(func.sum(OrderItem.line_total).desc(), OrderItem.product_name)
        .limit(TOP_PRODUCTS_LIMIT)
    ).all()
    return [
        {
            "product_id": product_id,
            "product_name": name,
            "units": int(units),
            "revenue": float(revenue),
            "orders": int(orders),
        }
        for product_id, name, units, revenue, orders in rows
    ]


# Roll every category up to its top-level department before grouping, so a
# product filed under "Snacks › Chips" still counts towards "Fresh Produce"'s
# siblings instead of creating a fragment nobody reads.
_CATEGORY_SALES_SQL = text(
    """
    WITH RECURSIVE reach AS (
        SELECT id, name, id AS root_id
        FROM categories
        WHERE parent_id IS NULL
        UNION ALL
        SELECT c.id, c.name, r.root_id
        FROM categories c
        JOIN reach r ON c.parent_id = r.id
    )
    SELECT root.id AS category_id,
           COALESCE(root.name, 'Uncategorised') AS name,
           COALESCE(SUM(oi.line_total), 0) AS revenue,
           COALESCE(SUM(oi.quantity), 0) AS units
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN reach r ON r.id = c.id
    LEFT JOIN categories root ON root.id = r.root_id
    WHERE o.placed_at >= CAST(:start AS timestamptz)
      AND o.placed_at < CAST(:end AS timestamptz)
      AND o.status <> 'cancelled'
    GROUP BY root.id, root.name
    ORDER BY revenue DESC, name
    """
)


def _category_sales(db: Session, start: datetime, end: datetime) -> list[dict]:
    rows = db.execute(_CATEGORY_SALES_SQL.bindparams(start=start, end=end)).all()
    return [
        {
            "category_id": category_id,
            "name": name,
            "revenue": float(revenue),
            "units": int(units),
        }
        for category_id, name, revenue, units in rows
    ]


def _low_stock(db: Session, threshold: int | None) -> list[dict]:
    available = func.greatest(Inventory.quantity - Inventory.reserved, 0)
    condition = (
        available <= threshold
        if threshold is not None
        # No override: each variant is compared against its own configured
        # low_stock_threshold (the stock screen edits it per row).
        else available <= Inventory.low_stock_threshold
    )
    rows = db.execute(
        select(
            ProductVariant.id,
            ProductVariant.sku,
            ProductVariant.name,
            Product.name,
            Product.slug,
            Inventory.quantity,
            available,
            Inventory.low_stock_threshold,
        )
        .join(Inventory, Inventory.variant_id == ProductVariant.id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(condition)
        .order_by(available, Product.name, ProductVariant.sku)
        .limit(LOW_STOCK_LIMIT)
    ).all()
    return [
        {
            "variant_id": variant_id,
            "sku": sku,
            "product_name": product_name,
            "product_slug": slug,
            "variant_name": variant_name,
            "quantity": int(quantity),
            "available": int(avail),
            "threshold": threshold if threshold is not None else int(row_threshold),
        }
        for variant_id, sku, variant_name, product_name, slug, quantity, avail, row_threshold in rows
    ]


def _recent_orders(db: Session, start: datetime, end: datetime) -> list[dict]:
    rows = db.execute(
        select(
            Order.id,
            Order.order_number,
            User.full_name,
            Order.total,
            Order.status,
            Order.placed_at,
        )
        .join(User, User.id == Order.user_id)
        .where(Order.placed_at >= start, Order.placed_at < end)
        .order_by(Order.placed_at.desc(), Order.id.desc())
        .limit(RECENT_LIMIT)
    ).all()
    return [
        {
            "id": order_id,
            "order_number": number,
            "customer": customer,
            "total": float(total),
            "status": status,
            "placed_at": placed_at,
        }
        for order_id, number, customer, total, status, placed_at in rows
    ]


def _recent_activity(db: Session, start: datetime, end: datetime) -> list[dict]:
    rows = db.execute(
        select(
            AuditLog.id,
            AuditLog.action,
            AuditLog.entity,
            AuditLog.entity_id,
            User.email,
            AuditLog.detail,
            AuditLog.created_at,
        )
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(AuditLog.created_at >= start, AuditLog.created_at < end)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(RECENT_LIMIT)
    ).all()
    return [
        {
            "id": log_id,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "actor": actor,
            "detail": detail or {},
            "created_at": created_at,
        }
        for log_id, action, entity, entity_id, actor, detail, created_at in rows
    ]


def invalidate_report_cache() -> None:
    cache_delete_prefix(REPORT_CACHE_PREFIX)


def overview(
    db: Session,
    kind: str,
    start_date: date | None,
    end_date: date | None,
    threshold: int | None,
) -> dict:
    """The whole dashboard payload for one window, computed once and cached."""
    start, end = window_for(kind, start_date, end_date)
    length = end - start
    prev_start, prev_end = start - length, start
    bucket = "hour" if length <= timedelta(days=1) else "day"

    cache_key = (
        f"{REPORT_CACHE_PREFIX}overview:{kind}"
        f":{start.isoformat()}:{end.isoformat()}:{threshold if threshold is not None else 'auto'}"
    )
    cached = cache_get(cache_key)
    if cached is not None:
        return json.loads(cached)

    current = _order_totals(db, start, end)
    previous = _order_totals(db, prev_start, prev_end)
    customers_now = _new_customers(db, start, end)
    customers_before = _new_customers(db, prev_start, prev_end)

    payload = {
        "range": {
            "kind": kind,
            "start": start,
            "end": end,
            "bucket": bucket,
            "previous_start": prev_start,
            "previous_end": prev_end,
        },
        "kpis": {
            "revenue": _metric(current["revenue"], previous["revenue"]),
            "orders": _metric(current["orders"], previous["orders"]),
            "new_customers": _metric(customers_now, customers_before),
            "avg_order_value": _metric(current["avg"], previous["avg"]),
        },
        "revenue_series": _series(db, start, end, bucket),
        "status_breakdown": _status_breakdown(db, start, end),
        "top_products": _top_products(db, start, end),
        "category_sales": _category_sales(db, start, end),
        "low_stock": _low_stock(db, threshold),
        "recent_orders": _recent_orders(db, start, end),
        "recent_activity": _recent_activity(db, start, end),
        "generated_at": datetime.now(UTC),
    }
    # json.dumps needs plain strings; datetime is the only non-primitive left.
    cache_set(cache_key, json.dumps(payload, default=str), REPORT_CACHE_TTL)
    return payload


CSV_HEADER = [
    "order_number",
    "placed_at",
    "status",
    "payment_method",
    "payment_status",
    "customer",
    "email",
    "city",
    "state",
    "subtotal",
    "discount_total",
    "delivery_fee",
    "total",
    "coupon_code",
]


def _csv_line(values: list[object]) -> str:
    # csv.writer quotes correctly (commas/quotes in names); an in-memory
    # buffer per row keeps the generator streaming line by line.
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\r\n").writerow(
        ["" if value is None else value for value in values]
    )
    return buffer.getvalue()


def iter_orders_csv(db: Session, start: datetime, end: datetime):
    """Stream every order in the window as CSV lines.

    `stream_results` keeps the driver on a server-side cursor, so a large
    export never materialises in the API process.
    """
    stmt = (
        select(
            Order.order_number,
            Order.placed_at,
            Order.status,
            Order.payment_method,
            Order.payment_status,
            User.full_name,
            User.email,
            Order.city,
            Order.state,
            Order.subtotal,
            Order.discount_total,
            Order.delivery_fee,
            Order.total,
            Order.coupon_code,
        )
        .join(User, User.id == Order.user_id)
        .where(Order.placed_at >= start, Order.placed_at < end)
        .order_by(Order.placed_at.asc(), Order.id.asc())
        .execution_options(stream_results=True)
    )
    yield _csv_line(CSV_HEADER)
    for row in db.execute(stmt):
        yield _csv_line(
            [
                row.order_number,
                row.placed_at.isoformat(),
                row.status.value,
                row.payment_method,
                row.payment_status.value,
                row.full_name,
                row.email,
                row.city,
                row.state,
                str(row.subtotal),
                str(row.discount_total),
                str(row.delivery_fee),
                str(row.total),
                row.coupon_code,
            ]
        )
