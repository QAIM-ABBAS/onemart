from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_staff
from app.core.pagination import Page, PaginationParams
from app.modules.reviews import service
from app.modules.reviews.schemas import ReviewModerateIn, ReviewOut
from app.modules.users.models import User

router = APIRouter(prefix="/admin", tags=["admin-reviews"])


@router.get("/reviews", response_model=Page[ReviewOut])
def admin_reviews(
    db: Session = Depends(get_db),
    staff: User = Depends(get_current_staff),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: str = "newest",
    rating: int | None = Query(None, ge=1, le=5),
    status: Literal["visible", "hidden"] | None = None,
    product_id: int | None = Query(None, ge=1),
    q: str | None = Query(None, max_length=120),
):
    params = PaginationParams(page=page, page_size=page_size, sort=sort)
    return service.admin_list(
        db,
        params,
        rating=rating,
        status=status,
        product_id=product_id,
        q=q,
        viewer=staff,
    )


@router.patch("/reviews/{review_id}", response_model=ReviewOut)
def moderate_review(
    review_id: int,
    payload: ReviewModerateIn,
    db: Session = Depends(get_db),
    staff: User = Depends(get_current_staff),
):
    review = service.get_review(db, review_id)
    service.moderate_visibility(
        db, review, is_visible=payload.is_visible, actor=staff
    )
    return service.to_out(review, viewer=staff)


@router.delete("/reviews/{review_id}", status_code=204)
def delete_review(
    review_id: int,
    db: Session = Depends(get_db),
    staff: User = Depends(get_current_staff),
):
    review = service.get_review(db, review_id)
    service.delete_review(db, review, actor=staff, audited=True)
    return Response(status_code=204)
