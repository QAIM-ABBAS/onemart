"""Response shapes for the admin reports dashboard.

Every number here is produced by a SQL aggregate (GROUP BY / count / sum) in
the service module — rows are never pulled into Python to be summed.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.modules.orders.models import OrderStatus

RangeKind = Literal["today", "7d", "30d", "custom"]


class ReportRange(BaseModel):
    """The selected half-open window [start, end) in UTC, plus the
    same-length window immediately before it (used for the deltas)."""

    kind: RangeKind
    start: datetime
    end: datetime
    bucket: Literal["hour", "day"]
    previous_start: datetime
    previous_end: datetime


class Metric(BaseModel):
    current: float
    previous: float
    # None when the previous window was zero — the ratio is undefined.
    delta_pct: float | None


class ReportKpis(BaseModel):
    revenue: Metric  # sum of non-cancelled orders in the window
    orders: Metric  # orders placed, cancellations included
    new_customers: Metric  # customer-role signups
    avg_order_value: Metric  # revenue / non-cancelled orders


class SeriesPoint(BaseModel):
    bucket: datetime
    revenue: float
    orders: int


class StatusCounts(BaseModel):
    status: OrderStatus
    orders: int
    revenue: float


class TopProduct(BaseModel):
    product_id: int | None  # None = product deleted after the sale
    product_name: str
    units: int
    revenue: float
    orders: int


class CategorySales(BaseModel):
    category_id: int | None  # None = product with no reachable category
    name: str
    revenue: float
    units: int


class LowStockRow(BaseModel):
    variant_id: int
    sku: str
    product_name: str
    product_slug: str
    variant_name: str
    quantity: int
    available: int
    threshold: int  # the threshold the row was compared against


class RecentOrderRow(BaseModel):
    id: int
    order_number: str
    customer: str
    total: float
    status: OrderStatus
    placed_at: datetime


class ActivityRow(BaseModel):
    id: int
    action: str
    entity: str
    entity_id: int | None
    actor: str | None  # actor email; None after the user was deleted
    detail: dict
    created_at: datetime


class ReportOverview(BaseModel):
    range: ReportRange
    kpis: ReportKpis
    revenue_series: list[SeriesPoint]
    status_breakdown: list[StatusCounts]
    top_products: list[TopProduct]
    category_sales: list[CategorySales]
    low_stock: list[LowStockRow]
    recent_orders: list[RecentOrderRow]
    recent_activity: list[ActivityRow]
    generated_at: datetime
