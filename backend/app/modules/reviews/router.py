from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, get_current_user_optional
from app.core.pagination import PaginationParams
from app.modules.reviews import service
from app.modules.reviews.schemas import HelpfulOut, ReviewIn, ReviewOut, ReviewPage
from app.modules.users.models import User

router = APIRouter(tags=["reviews"])


@router.get("/products/{slug}/reviews", response_model=ReviewPage)
def product_reviews(
    slug: str,
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    sort: str = "newest",
    rating: int | None = Query(None, ge=1, le=5),
    viewer: User | None = Depends(get_current_user_optional),
):
    product = service.get_product(db, slug)
    params = PaginationParams(page=page, page_size=page_size, sort=sort)
    return service.list_reviews(db, product, params, rating=rating, viewer=viewer)


@router.post(
    "/products/{slug}/reviews", response_model=ReviewOut, status_code=201
)
def create_review(
    slug: str,
    payload: ReviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    product = service.get_product(db, slug)
    review = service.create_review(db, user, product, payload)
    return service.to_out(review, viewer=user)


@router.patch("/reviews/{review_id}", response_model=ReviewOut)
def update_review(
    review_id: int,
    payload: ReviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    review = service.owned_review(db, review_id, user)
    service.update_review(db, review, payload)
    return service.to_out(review, viewer=user)


@router.delete("/reviews/{review_id}", status_code=204)
def delete_review(
    review_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    review = service.owned_review(db, review_id, user)
    service.delete_review(db, review, actor=user, audited=False)
    return Response(status_code=204)


@router.post("/reviews/{review_id}/helpful", response_model=HelpfulOut)
def toggle_helpful(
    review_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    review = service.get_review(db, review_id)
    return service.toggle_helpful(db, review, user)
