from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.pagination import Page, PaginationParams
from app.modules.orders import service as orders_service
from app.modules.orders.models import OrderStatus
from app.modules.orders.schemas import OrderDetail, OrderListItem
from app.modules.users.models import User

router = APIRouter(tags=["orders"])

STATUSES = ", ".join(s.value for s in OrderStatus)


@router.get("/orders", response_model=Page[OrderListItem])
def my_orders(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    sort: str = "newest",
    status: OrderStatus | None = None,
):
    params = PaginationParams(page=page, page_size=page_size, sort=sort)
    return orders_service.list_customer_orders(db, user, params)


@router.get("/orders/{order_id}", response_model=OrderDetail)
def my_order(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    order = orders_service.get_customer_order(db, user, order_id)
    return orders_service.order_to_detail(order)


@router.post("/orders/{order_id}/cancel", response_model=OrderDetail)
def cancel_my_order(
    order_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Cancel your own order while it is still Pending/Confirmed.

    Stock returns to the shelf in the same transaction and a history row is
    written; the transition rules make this a dead endpoint once packed.
    """
    order = orders_service.get_customer_order(db, user, order_id)
    orders_service.cancel_customer_order(db, order, user)
    return orders_service.order_to_detail(order)
