from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_staff
from app.core.pagination import Page
from app.modules.inventory.service import (
    InventoryQuery,
    InventoryRow,
    StockAdjustment,
    adjust_stock,
    list_inventory,
)
from app.modules.users.models import User

router = APIRouter(prefix="/admin", tags=["admin-inventory"])


@router.get("/inventory", response_model=Page[InventoryRow])
def admin_inventory(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: str = "product",
    q: str | None = None,
    low_stock: bool = False,
    out_of_stock: bool = False,
):
    params = InventoryQuery(
        page=page, page_size=page_size, sort=sort, q=q,
        low_stock=low_stock, out_of_stock=out_of_stock,
    )
    return list_inventory(db, params)


@router.post("/inventory/adjust")
def admin_adjust_stock(
    payload: StockAdjustment,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_staff),
):
    inventory = adjust_stock(db, payload, actor_id=user.id)
    db.commit()
    from app.modules.catalog.service import invalidate_catalog_cache

    invalidate_catalog_cache()
    return {
        "variant_id": inventory.variant_id,
        "quantity": inventory.quantity,
        "available": inventory.available,
        "updated_at": inventory.updated_at.isoformat(),
    }
