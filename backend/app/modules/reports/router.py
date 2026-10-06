from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_staff
from app.modules.reports import service
from app.modules.reports.schemas import RangeKind, ReportOverview
from app.modules.users.models import User

router = APIRouter(prefix="/admin", tags=["admin-reports"])


@router.get("/reports/overview", response_model=ReportOverview)
def reports_overview(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
    range_: RangeKind = Query("7d", alias="range"),
    start: date | None = None,
    end: date | None = None,
    threshold: int | None = Query(None, ge=0, le=10_000),
):
    """Every number on the dashboard: SQL aggregates over the selected window
    (plus the same-length previous window for the deltas), cached 60s."""
    return service.overview(db, range_, start, end, threshold)


@router.get("/reports/orders.csv")
def export_orders_csv(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
    range_: RangeKind = Query("7d", alias="range"),
    start: date | None = None,
    end: date | None = None,
):
    """CSV export of every order placed in the selected window, streamed."""
    window_start, window_end = service.window_for(range_, start, end)
    last_day: datetime = window_end - timedelta(days=1)
    filename = f"onemart-orders_{window_start.date()}_{last_day.date()}.csv"
    return StreamingResponse(
        service.iter_orders_csv(db, window_start, window_end),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
