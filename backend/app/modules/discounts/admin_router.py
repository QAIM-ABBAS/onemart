from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_staff
from app.core.pagination import Page, PaginationParams
from app.modules.discounts import admin_service
from app.modules.discounts.schemas import (
    CouponAdminOut,
    CouponWrite,
    DiscountAdminOut,
    DiscountWrite,
)
from app.modules.users.models import User

router = APIRouter(prefix="/admin", tags=["admin-discounts"])

Status = Literal["active", "scheduled", "expired", "inactive"]
CouponSort = Literal["newest", "oldest", "code", "usage", "expiry"]
DiscountSort = Literal["newest", "oldest", "value", "expiry"]


@router.get("/coupons", response_model=Page[CouponAdminOut])
def admin_coupons(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: CouponSort = "newest",
    status: Status | None = None,
    q: str | None = Query(None, max_length=120),
):
    """All coupons with their computed status chip, usage counts, and a
    search box over code/description."""
    params = PaginationParams(page=page, page_size=page_size, sort=sort)
    return admin_service.admin_list_coupons(db, params, q=q, status=status)


@router.post("/coupons", response_model=CouponAdminOut, status_code=201)
def admin_create_coupon(
    payload: CouponWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    coupon = admin_service.create_coupon(db, payload)
    db.commit()
    return admin_service.coupon_out(coupon)


@router.patch("/coupons/{coupon_id}", response_model=CouponAdminOut)
def admin_update_coupon(
    coupon_id: int,
    payload: CouponWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    coupon = admin_service.get_coupon(db, coupon_id)
    admin_service.update_coupon(db, coupon, payload)
    db.commit()
    return admin_service.coupon_out(coupon)


@router.delete("/coupons/{coupon_id}", status_code=204)
def admin_delete_coupon(
    coupon_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    coupon = admin_service.get_coupon(db, coupon_id)
    admin_service.delete_coupon(db, coupon)
    db.commit()
    return Response(status_code=204)


@router.get("/discounts", response_model=Page[DiscountAdminOut])
def admin_discounts(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: DiscountSort = "newest",
    scope: Literal["product", "category"] | None = None,
    status: Status | None = None,
    q: str | None = Query(None, max_length=120),
):
    """Automatic discount rules with the target's name and status chip."""
    params = PaginationParams(page=page, page_size=page_size, sort=sort)
    return admin_service.admin_list_discounts(db, params, q=q, status=status, scope=scope)


@router.post("/discounts", response_model=DiscountAdminOut, status_code=201)
def admin_create_discount(
    payload: DiscountWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    discount = admin_service.create_discount(db, payload)
    db.commit()
    return admin_service.discount_detail(db, discount)


@router.patch("/discounts/{discount_id}", response_model=DiscountAdminOut)
def admin_update_discount(
    discount_id: int,
    payload: DiscountWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    discount = admin_service.get_discount(db, discount_id)
    admin_service.update_discount(db, discount, payload)
    db.commit()
    return admin_service.discount_detail(db, discount)


@router.delete("/discounts/{discount_id}", status_code=204)
def admin_delete_discount(
    discount_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    discount = admin_service.get_discount(db, discount_id)
    admin_service.delete_discount(db, discount)
    db.commit()
    return Response(status_code=204)
