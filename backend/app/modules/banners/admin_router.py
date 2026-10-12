"""Admin banner management: CRUD, scheduling rules, reorder, image upload."""

from typing import Literal

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_staff
from app.core.pagination import Page, PaginationParams
from app.core.storage import save_banner_image
from app.modules.banners import admin_service
from app.modules.banners.models import BannerPlacement
from app.modules.banners.schemas import (
    BannerAdminOut,
    BannerWrite,
    ReorderIn,
    UploadOut,
)
from app.modules.users.models import User

router = APIRouter(prefix="/admin/banners", tags=["admin-banners"])

Status = Literal["active", "scheduled", "expired", "inactive"]
Placement = Literal["home_hero", "home_mid_strip", "category_header", "cart_promo"]


def _params(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: str = Query("priority"),
) -> PaginationParams:
    return PaginationParams(page=page, page_size=page_size, sort=sort)


def _out(db: Session, banner_id: int) -> BannerAdminOut:
    banner = admin_service.get_banner(db, banner_id)
    return admin_service.admin_out(
        db, banner, admin_service.pending_stats(db, [banner.id])
    )


@router.get("", response_model=Page[BannerAdminOut])
def admin_list_banners(
    params: PaginationParams = Depends(_params),
    q: str | None = Query(None, max_length=100),
    placement: Placement | None = Query(None),
    status: Status | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    return admin_service.list_banners(
        db, params, q=q, placement=placement, status=status
    )


@router.post("", response_model=BannerAdminOut, status_code=201)
def admin_create_banner(
    payload: BannerWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    banner = admin_service.create_banner(db, payload)
    db.commit()
    return _out(db, banner.id)


# Declared before "/{banner_id}": FastAPI resolves routes in order, and
# "reorder" would otherwise be swallowed by the int path parameter.
@router.patch("/reorder", response_model=list[BannerAdminOut])
def admin_reorder_banners(
    payload: ReorderIn,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    """Drag-to-reorder: ids arrive in their new display order."""
    admin_service.reorder_banners(db, payload)
    db.commit()
    return [_out(db, banner_id) for banner_id in payload.ids]


@router.patch("/{banner_id}", response_model=BannerAdminOut)
def admin_update_banner(
    banner_id: int,
    payload: BannerWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    banner = admin_service.get_banner(db, banner_id)
    admin_service.update_banner(db, banner, payload)
    db.commit()
    return _out(db, banner_id)


@router.delete("/{banner_id}", status_code=204)
def admin_delete_banner(
    banner_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    banner = admin_service.get_banner(db, banner_id)
    admin_service.delete_banner(db, banner)
    db.commit()
    return Response(status_code=204)


@router.post("/upload", response_model=UploadOut)
def admin_upload_image(
    file: UploadFile = File(...),
    _: User = Depends(get_current_staff),
):
    """Validate + resize one creative into its desktop and mobile WebP
    variants (stored on the configured storage backend)."""
    desktop, mobile = save_banner_image(file)
    return UploadOut(image_desktop=desktop, image_mobile=mobile)


# Placement list for the admin form's select — kept here so the enum is
# single-sourced from the model rather than retyped in the frontend.
@router.get("/placements", response_model=list[str])
def admin_list_placements(_: User = Depends(get_current_staff)):
    return [placement.value for placement in BannerPlacement]
