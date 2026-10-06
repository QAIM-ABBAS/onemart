from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.core.pagination import Page, PaginationParams
from app.modules.audit import service as audit_service
from app.modules.catalog.models import Product
from app.modules.catalog.service import invalidate_catalog_cache
from app.modules.notifications import service as notifications_service
from app.modules.notifications.models import NotificationType
from app.modules.orders.models import Order, OrderItem, OrderStatus
from app.modules.reviews.models import Review, ReviewVote
from app.modules.reviews.schemas import (
    HelpfulOut,
    RatingBucket,
    RatingSummary,
    ReviewIn,
    ReviewOut,
    ReviewPage,
)
from app.modules.users.models import User, UserRole

# Customer sort set (newest / highest / lowest / most helpful) + oldest for admin.
SORTS: dict[str, tuple] = {
    "newest": (desc(Review.created_at), desc(Review.id)),
    "oldest": (asc(Review.created_at), asc(Review.id)),
    "highest": (desc(Review.rating), desc(Review.created_at)),
    "lowest": (asc(Review.rating), desc(Review.created_at)),
    "most_helpful": (desc(Review.helpful_count), desc(Review.created_at)),
}
DEFAULT_SORT = "newest"


def get_product(db: Session, slug: str) -> Product:
    product = db.scalar(
        select(Product).where(Product.slug == slug, Product.is_active.is_(True))
    )
    if product is None:
        raise NotFoundError("Product not found")
    return product


def get_review(db: Session, review_id: int) -> Review:
    review = db.get(Review, review_id)
    if review is None:
        raise NotFoundError("Review not found")
    return review


def owned_review(db: Session, review_id: int, actor: User) -> Review:
    """Owners may edit their own review; staff may edit anyone's."""
    review = get_review(db, review_id)
    if review.user_id != actor.id and actor.role == UserRole.CUSTOMER:
        raise ForbiddenError("You can only change your own review")
    return review


def rating_summary(db: Session, product: Product) -> RatingSummary:
    """Aggregate straight from the reviews table — one GROUP BY, no rows into Python."""
    rows = db.execute(
        select(Review.rating, func.count(Review.id))
        .where(Review.product_id == product.id, Review.is_visible.is_(True))
        .group_by(Review.rating)
    ).all()
    counts = {rating: count for rating, count in rows}
    total = sum(counts.values())
    average = (
        round(sum(rating * count for rating, count in counts.items()) / total, 2)
        if total
        else 0.0
    )
    return RatingSummary(
        average=average,
        count=total,
        distribution=[RatingBucket(rating=r, count=counts.get(r, 0)) for r in (5, 4, 3, 2, 1)],
    )


def recompute_rating(db: Session, product: Product) -> None:
    """Rewrite product.rating_avg/rating_count in the caller's transaction."""
    # Sessions run with autoflush off: flush first, or the aggregate below would
    # count the pre-edit / pre-hide values still sitting in the identity map.
    db.flush()
    rows = db.execute(
        select(Review.rating, func.count(Review.id))
        .where(Review.product_id == product.id, Review.is_visible.is_(True))
        .group_by(Review.rating)
    ).all()
    total = sum(count for _, count in rows)
    product.rating_count = total
    product.rating_avg = (
        round(sum(rating * count for rating, count in rows) / total, 2) if total else 0
    )
    db.flush()


def _verified_purchase(db: Session, user_id: int, product_id: int) -> bool:
    """True when this customer has a DELIVERED order containing the product."""
    stmt = (
        select(Order.id)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .where(
            Order.user_id == user_id,
            Order.status == OrderStatus.DELIVERED,
            OrderItem.product_id == product_id,
        )
        .limit(1)
    )
    return db.scalar(stmt) is not None


def to_out(review: Review, *, viewer: User | None = None, voted_ids=frozenset()) -> ReviewOut:
    product = review.product
    author = review.user
    can_edit = viewer is not None and (
        viewer.id == review.user_id or viewer.role != UserRole.CUSTOMER
    )
    return ReviewOut(
        id=review.id,
        product_id=review.product_id,
        product_name=product.name if product else "",
        product_slug=product.slug if product else "",
        user_id=review.user_id,
        author=author.full_name if author else "Customer",
        rating=review.rating,
        title=review.title,
        body=review.body,
        verified_purchase=review.verified_purchase,
        is_visible=review.is_visible,
        helpful_count=review.helpful_count,
        viewer_has_voted=review.id in voted_ids,
        can_edit=can_edit,
        created_at=review.created_at,
        updated_at=review.updated_at,
    )


def _voted_ids(db: Session, viewer: User | None, review_ids: list[int]) -> set[int]:
    if viewer is None or not review_ids:
        return set()
    return set(
        db.scalars(
            select(ReviewVote.review_id).where(
                ReviewVote.user_id == viewer.id, ReviewVote.review_id.in_(review_ids)
            )
        ).all()
    )


def _page(db: Session, stmt, params: PaginationParams, build) -> Page:
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(*SORTS.get(params.sort, SORTS[DEFAULT_SORT]))
        .offset(params.offset)
        .limit(params.page_size)
    ).all()
    pages = max((total + params.page_size - 1) // params.page_size, 1) if total else 1
    return build(rows, total, pages)


def list_reviews(
    db: Session,
    product: Product,
    params: PaginationParams,
    *,
    rating: int | None = None,
    viewer: User | None = None,
) -> ReviewPage:
    """Public list: visible reviews only, paginated + sortable + filterable."""
    stmt = select(Review).where(
        Review.product_id == product.id, Review.is_visible.is_(True)
    )
    if rating is not None:
        stmt = stmt.where(Review.rating == rating)

    def build(rows, total, pages) -> ReviewPage:
        voted = _voted_ids(db, viewer, [r.id for r in rows])
        return ReviewPage(
            items=[to_out(r, viewer=viewer, voted_ids=voted) for r in rows],
            total=total,
            page=params.page,
            page_size=params.page_size,
            pages=pages,
            summary=rating_summary(db, product),
        )

    return _page(db, stmt, params, build)


def admin_list(
    db: Session,
    params: PaginationParams,
    *,
    rating: int | None = None,
    status: str | None = None,
    product_id: int | None = None,
    q: str | None = None,
    viewer: User | None = None,
) -> Page[ReviewOut]:
    """Moderation queue: filter by rating / product / visibility, search, sort."""
    stmt = select(Review)
    if rating is not None:
        stmt = stmt.where(Review.rating == rating)
    if status == "visible":
        stmt = stmt.where(Review.is_visible.is_(True))
    elif status == "hidden":
        stmt = stmt.where(Review.is_visible.is_(False))
    if product_id is not None:
        stmt = stmt.where(Review.product_id == product_id)
    if q and q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.join(Review.product).join(Review.user).where(
            or_(
                Review.title.ilike(term),
                Product.name.ilike(term),
                User.full_name.ilike(term),
            )
        )

    def build(rows, total, pages) -> Page[ReviewOut]:
        voted = _voted_ids(db, viewer, [r.id for r in rows])
        return Page[ReviewOut](
            items=[to_out(r, viewer=viewer, voted_ids=voted) for r in rows],
            total=total,
            page=params.page,
            page_size=params.page_size,
            pages=pages,
        )

    return _page(db, stmt, params, build)


def create_review(
    db: Session, user: User, product: Product, payload: ReviewIn
) -> Review:
    existing = db.scalar(
        select(Review.id).where(
            Review.product_id == product.id, Review.user_id == user.id
        )
    )
    if existing is not None:
        raise ConflictError(
            "You have already reviewed this product",
            details={"review_id": existing},
        )

    review = Review(
        product_id=product.id,
        user_id=user.id,
        rating=payload.rating,
        title=payload.title,
        body=payload.body,
        verified_purchase=_verified_purchase(db, user.id, product.id),
    )
    db.add(review)
    try:
        db.flush()
    except IntegrityError:
        # Two tabs submitted at once: the unique constraint is the real guard.
        db.rollback()
        raise ConflictError("You have already reviewed this product") from None

    recompute_rating(db, product)
    db.commit()
    invalidate_catalog_cache()
    return review


def update_review(db: Session, review: Review, payload: ReviewIn) -> Review:
    product = db.get(Product, review.product_id)
    review.rating = payload.rating
    review.title = payload.title
    review.body = payload.body
    # The order may have been delivered since the first write (and a staff edit
    # must never re-derive the flag from the moderator's own orders).
    review.verified_purchase = _verified_purchase(db, review.user_id, review.product_id)
    if product is not None:
        recompute_rating(db, product)
    db.commit()
    invalidate_catalog_cache()
    return review


def delete_review(db: Session, review: Review, *, actor: User, audited: bool) -> None:
    product_id = review.product_id
    if audited:
        audit_service.record(
            db,
            actor_id=actor.id,
            action="review.delete",
            entity="review",
            entity_id=review.id,
            detail={
                "product_id": product_id,
                "rating": review.rating,
                "author_id": review.user_id,
            },
        )
    db.delete(review)
    db.flush()
    product = db.get(Product, product_id)
    if product is not None:
        recompute_rating(db, product)
    db.commit()
    invalidate_catalog_cache()


def moderate_visibility(
    db: Session, review: Review, *, is_visible: bool, actor: User
) -> Review:
    """Hide/unhide a review. Hidden reviews leave the public list *and* the average."""
    if review.is_visible == is_visible:
        raise ConflictError(
            f"Review is already {'visible' if is_visible else 'hidden'}"
        )
    review.is_visible = is_visible
    product = db.get(Product, review.product_id)
    if product is not None:
        recompute_rating(db, product)
    audit_service.record(
        db,
        actor_id=actor.id,
        action="review.hide" if not is_visible else "review.unhide",
        entity="review",
        entity_id=review.id,
        detail={"product_id": review.product_id, "rating": review.rating},
    )
    if not is_visible:
        # Only hiding is an event worth telling the author about (unhiding is
        # the moderator undoing their own action).
        notifications_service.notify(
            db,
            user_id=review.user_id,
            type=NotificationType.REVIEW_HIDDEN,
            title="Your review was hidden",
            body=(
                f"A moderator hid your review of {product.name} from the product page."
                if product is not None
                else "A moderator hid your review from the product page."
            ),
            link=f"/p/{product.slug}" if product is not None else None,
        )
    db.commit()
    invalidate_catalog_cache()
    return review


def toggle_helpful(db: Session, review: Review, user: User) -> HelpfulOut:
    """One mark per customer per review; the count is recounted, never guessed."""
    vote = db.get(ReviewVote, {"review_id": review.id, "user_id": user.id})
    if vote is not None:
        db.delete(vote)
        voted = False
    else:
        db.add(ReviewVote(review_id=review.id, user_id=user.id))
        voted = True
    db.flush()
    review.helpful_count = (
        db.scalar(
            select(func.count()).select_from(ReviewVote).where(
                ReviewVote.review_id == review.id
            )
        )
        or 0
    )
    db.commit()
    return HelpfulOut(helpful_count=review.helpful_count, viewer_has_voted=voted)
