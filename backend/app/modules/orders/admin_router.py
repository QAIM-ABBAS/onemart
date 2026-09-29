from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_staff
from app.core.pagination import Page, PaginationParams
from app.modules.catalog.service import invalidate_catalog_cache
from app.modules.orders import service as orders_service
from app.modules.orders.models import Order, OrderStatus
from app.modules.orders.schemas import OrderDetail, OrderListItem, StatusUpdateIn
from app.modules.users.models import User

router = APIRouter(prefix="/admin", tags=["admin-orders"])

STATUSES = ", ".join(s.value for s in OrderStatus)


@router.get("/orders", response_model=Page[OrderListItem])
def admin_orders(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: str = "newest",
    status: OrderStatus | None = None,
    q: str | None = None,
):
    params = PaginationParams(page=page, page_size=page_size, sort=sort)
    return orders_service.list_admin_orders(db, params, status, q)


@router.get("/orders/{order_id}", response_model=OrderDetail)
def admin_order(
    order_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    order = orders_service.get_admin_order(db, order_id)
    return orders_service.order_to_detail(order)


@router.patch("/orders/{order_id}/status", response_model=OrderDetail)
def admin_update_status(
    order_id: int,
    payload: StatusUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_staff),
):
    order = orders_service.get_admin_order(db, order_id)
    orders_service.update_order_status(db, order, payload, user)
    invalidate_catalog_cache()
    return orders_service.order_to_detail(order)


@router.get("/stats")
def admin_stats(db: Session = Depends(get_db), _: User = Depends(get_current_staff)):
    total_orders = db.scalar(select(func.count()).select_from(Order)) or 0
    revenue = (
        db.scalar(
            select(func.coalesce(func.sum(Order.total), 0)).where(
                Order.status == OrderStatus.DELIVERED
            )
        )
        or 0
    )
    pending = (
        db.scalar(
            select(func.count()).select_from(Order).where(Order.status == OrderStatus.PENDING)
        )
        or 0
    )
    from app.modules.catalog.models import Product
    from app.modules.inventory.models import Inventory

    low_stock = (
        db.execute(
            select(func.count()).select_from(Inventory).where(Inventory.quantity <= Inventory.low_stock_threshold)
        ).scalar_one()
        or 0
    )
    products = db.scalar(select(func.count()).select_from(Product)) or 0
    return {
        "orders": total_orders,
        "revenue": float(revenue),
        "pending_orders": pending,
        "low_stock_variants": low_stock,
        "products": products,
    }
