"""Admin flash-deal management: deal CRUD, items with live counters, search."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_staff
from app.core.exceptions import NotFoundError
from app.core.pagination import Page, PaginationParams
from app.modules.flash import admin_service
from app.modules.flash.models import FlashDealItem
from app.modules.flash.schemas import (
    DealAdminOut,
    DealItemAdminOut,
    DealItemWrite,
    DealWrite,
    VariantSearchRow,
)
from app.modules.users.models import User

router = APIRouter(prefix="/admin/flash-deals", tags=["admin-flash-deals"])


def _params(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: str = Query("newest"),
) -> PaginationParams:
    return PaginationParams(page=page, page_size=page_size, sort=sort)


def _out(db: Session, deal_id: int) -> DealAdminOut:
    deal = admin_service.get_deal(db, deal_id)
    return admin_service.admin_out(db, deal, datetime.now(UTC))


def _item_out(db: Session, item_id: int) -> DealItemAdminOut:
    item = db.get(FlashDealItem, item_id)
    if item is None:
        raise NotFoundError("Deal item not found")
    for row in admin_service.list_items(db, admin_service.get_deal(db, item.deal_id)):
        if row.id == item_id:
            return row
    raise NotFoundError("Deal item not found")


@router.get("", response_model=Page[DealAdminOut])
def admin_list_deals(
    q: str | None = Query(None, max_length=120),
    status: str | None = Query(None, pattern="^(live|scheduled|ended|inactive)$"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
    params: PaginationParams = Depends(_params),
):
    return admin_service.list_deals(db, params, q=q, status=status)


@router.post("", response_model=DealAdminOut, status_code=201)
def admin_create_deal(
    payload: DealWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    deal = admin_service.create_deal(db, payload)
    db.commit()
    return _out(db, deal.id)


@router.get("/variant-search", response_model=Page[VariantSearchRow])
def admin_variant_search(
    q: str | None = Query(None, max_length=120),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
    params: PaginationParams = Depends(_params),
):
    return admin_service.variant_search(db, params, q=q)


@router.get("/{deal_id}", response_model=DealAdminOut)
def admin_get_deal(
    deal_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    return _out(db, deal_id)


@router.patch("/{deal_id}", response_model=DealAdminOut)
def admin_update_deal(
    deal_id: int,
    payload: DealWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    admin_service.update_deal(db, admin_service.get_deal(db, deal_id), payload)
    db.commit()
    return _out(db, deal_id)


@router.delete("/{deal_id}", status_code=204)
def admin_delete_deal(
    deal_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    admin_service.delete_deal(db, admin_service.get_deal(db, deal_id))
    db.commit()
    return Response(status_code=204)


@router.post("/{deal_id}/end", response_model=DealAdminOut)
def admin_end_deal_early(
    deal_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    admin_service.end_early(db, admin_service.get_deal(db, deal_id))
    db.commit()
    return _out(db, deal_id)


@router.get("/{deal_id}/items", response_model=list[DealItemAdminOut])
def admin_list_items(
    deal_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    return admin_service.list_items(db, admin_service.get_deal(db, deal_id))


@router.post("/{deal_id}/items", response_model=DealItemAdminOut, status_code=201)
def admin_add_item(
    deal_id: int,
    payload: DealItemWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    item = admin_service.add_item(db, admin_service.get_deal(db, deal_id), payload)
    db.commit()
    return _item_out(db, item.id)


@router.patch("/items/{item_id}", response_model=DealItemAdminOut)
def admin_update_item(
    item_id: int,
    payload: DealItemWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    item = db.get(FlashDealItem, item_id)
    if item is None:
        raise NotFoundError("Deal item not found")
    admin_service.update_item(db, item, payload)
    db.commit()
    return _item_out(db, item_id)


@router.delete("/items/{item_id}", status_code=204)
def admin_delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    item = db.get(FlashDealItem, item_id)
    if item is None:
        raise NotFoundError("Deal item not found")
    admin_service.delete_item(db, item)
    db.commit()
    return Response(status_code=204)
