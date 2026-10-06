"""Admin CRUD for coupons and automatic discounts.

Status is computed, never stored: *inactive* (switched off), *scheduled*
(window opens later), *expired* (window closed), *active* (running now). The
same logic backs every chip and the status filter, so a chip and a filtered
list can never disagree.

Validation runs once over the *merged* row — existing values plus whatever the
PATCH sent — so a partial update is checked exactly like a fresh create.
"""

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ConflictError, NotFoundError
from app.core.pagination import Page, PaginationParams
from app.modules.catalog.models import Category, Product
from app.modules.discounts.models import (
    Coupon,
    CouponKind,
    CouponRedemption,
    Discount,
    DiscountKind,
    DiscountScope,
)
from app.modules.discounts.schemas import (
    CouponAdminOut,
    CouponWrite,
    DiscountAdminOut,
    DiscountWrite,
)
from app.modules.discounts.service import _aware, normalize_code

COUPON_SORTS = {
    "newest": (Coupon.created_at.desc(),),
    "oldest": (Coupon.created_at.asc(),),
    "code": (Coupon.code.asc(),),
    "usage": (Coupon.used_count.desc(), Coupon.id.desc()),
    "expiry": (Coupon.ends_at.asc().nulls_last(), Coupon.id.desc()),
}

DISCOUNT_SORTS = {
    "newest": (Discount.created_at.desc(),),
    "oldest": (Discount.created_at.asc(),),
    "value": (Discount.value.desc(), Discount.id.desc()),
    "expiry": (Discount.ends_at.asc().nulls_last(), Discount.id.desc()),
}


def _field_error(message: str, field: str) -> AppError:
    """A 400 the frontend can attach to the offending input (same details shape
    FastAPI uses for its own 422s)."""
    return AppError(message, details=[{"field": field, "message": message}])


def status_of(*, is_active: bool, starts_at: datetime | None, ends_at: datetime | None) -> str:
    if not is_active:
        return "inactive"
    now = datetime.now(UTC)
    if starts_at is not None and now < _aware(starts_at):
        return "scheduled"
    if ends_at is not None and now >= _aware(ends_at):
        return "expired"
    return "active"


def _status_clause(model, status: str):
    """SQL twin of :func:`status_of` so filtering paginates correctly."""
    now = datetime.now(UTC)
    clauses = {
        "active": and_(
            model.is_active.is_(True),
            or_(model.starts_at.is_(None), model.starts_at <= now),
            or_(model.ends_at.is_(None), model.ends_at > now),
        ),
        "inactive": model.is_active.is_(False),
        "scheduled": and_(
            model.is_active.is_(True), model.starts_at.isnot(None), model.starts_at > now
        ),
        "expired": and_(
            model.is_active.is_(True), model.ends_at.isnot(None), model.ends_at <= now
        ),
    }
    return clauses[status]


def _pages(total: int, params: PaginationParams) -> int:
    if not total:
        return 1
    return max((total + params.page_size - 1) // params.page_size, 1)


# --------------------------------------------------------------------------
# Coupons
# --------------------------------------------------------------------------


def coupon_out(row: Coupon) -> CouponAdminOut:
    out = CouponAdminOut.model_validate(row, from_attributes=True)
    out.status = status_of(is_active=row.is_active, starts_at=row.starts_at, ends_at=row.ends_at)
    return out


def admin_list_coupons(
    db: Session,
    params: PaginationParams,
    *,
    q: str | None = None,
    status: str | None = None,
) -> Page[CouponAdminOut]:
    stmt = select(Coupon)
    if q and q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(Coupon.code.ilike(term), Coupon.description.ilike(term)))
    if status is not None:
        stmt = stmt.where(_status_clause(Coupon, status))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(*COUPON_SORTS.get(params.sort, COUPON_SORTS["newest"]))
        .offset(params.offset)
        .limit(params.page_size)
    ).all()
    return Page[CouponAdminOut](
        items=[coupon_out(row) for row in rows],
        total=total,
        page=params.page,
        page_size=params.page_size,
        pages=_pages(total, params),
    )


def get_coupon(db: Session, coupon_id: int) -> Coupon:
    coupon = db.get(Coupon, coupon_id)
    if coupon is None:
        raise NotFoundError("Coupon not found")
    return coupon


def _coupon_values(payload: CouponWrite, *, existing: Coupon | None) -> dict:
    data = payload.model_dump(exclude_unset=True)
    if data.get("code") is not None:
        data["code"] = normalize_code(str(data["code"]))

    if existing is None:
        missing = [field for field in ("code", "kind", "value") if field not in data]
        if missing:
            raise AppError(
                "Please check the highlighted fields",
                details=[
                    {"field": field, "message": "This field is required"} for field in missing
                ],
            )
        values: dict = {
            "description": None,
            "min_subtotal": 0.0,
            "max_discount": None,
            "starts_at": None,
            "ends_at": None,
            "usage_limit": None,
            "per_user_limit": None,
            "is_active": True,
        }
    else:
        values = {
            "code": existing.code,
            "description": existing.description,
            "kind": existing.kind.value,
            "value": float(existing.value),
            "min_subtotal": float(existing.min_subtotal),
            "max_discount": (
                float(existing.max_discount) if existing.max_discount is not None else None
            ),
            "starts_at": existing.starts_at,
            "ends_at": existing.ends_at,
            "usage_limit": existing.usage_limit,
            "per_user_limit": existing.per_user_limit,
            "is_active": existing.is_active,
        }
    values.update(data)
    return values


def _validated_coupon(v: dict) -> dict:
    code = v.get("code") or ""
    if not code:
        raise _field_error("Code is required", "code")
    kind = v.get("kind")
    if kind is None:
        raise _field_error("Pick a discount type", "kind")

    value = Decimal(str(v.get("value") if v.get("value") is not None else 0))
    if kind == "free_delivery":
        value = Decimal("0.00")  # the waived delivery carries the value
    elif kind == "percent":
        if value <= 0 or value > 100:
            raise _field_error("Percent must be between 1 and 100", "value")
    elif value <= 0:
        raise _field_error("Discount must be greater than 0", "value")

    starts = _aware(v["starts_at"]) if v.get("starts_at") else None
    ends = _aware(v["ends_at"]) if v.get("ends_at") else None
    if starts is not None and ends is not None and starts >= ends:
        raise _field_error("End must be after start", "ends_at")

    min_subtotal = Decimal(str(v.get("min_subtotal") or 0))
    if min_subtotal < 0:
        raise _field_error("Minimum order cannot be negative", "min_subtotal")
    max_discount = v.get("max_discount")
    if max_discount is not None and Decimal(str(max_discount)) <= 0:
        raise _field_error("Cap must be greater than 0", "max_discount")

    v.update(
        code=code,
        kind=kind,
        value=value,
        min_subtotal=min_subtotal,
        max_discount=Decimal(str(max_discount)) if max_discount is not None else None,
        starts_at=starts,
        ends_at=ends,
    )
    return v


def _assert_code_free(db: Session, code: str, *, exclude_id: int | None = None) -> None:
    stmt = select(Coupon.id).where(Coupon.code == code)
    if exclude_id is not None:
        stmt = stmt.where(Coupon.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise ConflictError(
            "That code is already in use",
            details=[{"field": "code", "message": "That code is already in use"}],
        )


def create_coupon(db: Session, payload: CouponWrite) -> Coupon:
    v = _validated_coupon(_coupon_values(payload, existing=None))
    _assert_code_free(db, v["code"])
    coupon = Coupon(
        code=v["code"],
        description=v["description"],
        kind=CouponKind(v["kind"]),
        value=v["value"],
        min_subtotal=v["min_subtotal"],
        max_discount=v["max_discount"],
        starts_at=v["starts_at"],
        ends_at=v["ends_at"],
        usage_limit=v["usage_limit"],
        per_user_limit=v["per_user_limit"],
        is_active=v["is_active"],
    )
    db.add(coupon)
    db.flush()
    return coupon


def update_coupon(db: Session, coupon: Coupon, payload: CouponWrite) -> Coupon:
    v = _validated_coupon(_coupon_values(payload, existing=coupon))
    if v["code"] != coupon.code:
        _assert_code_free(db, v["code"], exclude_id=coupon.id)

    coupon.code = v["code"]
    coupon.description = v["description"]
    coupon.kind = CouponKind(v["kind"])
    coupon.value = v["value"]
    coupon.min_subtotal = v["min_subtotal"]
    coupon.max_discount = v["max_discount"]
    coupon.starts_at = v["starts_at"]
    coupon.ends_at = v["ends_at"]
    coupon.usage_limit = v["usage_limit"]
    coupon.per_user_limit = v["per_user_limit"]
    coupon.is_active = v["is_active"]
    db.flush()
    return coupon


def delete_coupon(db: Session, coupon: Coupon) -> None:
    used = (
        db.scalar(
            select(func.count(CouponRedemption.id)).where(
                CouponRedemption.coupon_id == coupon.id
            )
        )
        or 0
    )
    if used:
        # The cascade would take the redemption history with it — deactivation
        # keeps the audit trail intact instead.
        raise ConflictError(
            f"This coupon has been redeemed {used} time"
            f"{'s' if used != 1 else ''} — turn it off instead of deleting it."
        )
    db.delete(coupon)
    db.flush()


# --------------------------------------------------------------------------
# Discounts
# --------------------------------------------------------------------------


def discount_out(
    row: Discount, product_name: str | None = None, category_name: str | None = None
) -> DiscountAdminOut:
    out = DiscountAdminOut.model_validate(row, from_attributes=True)
    out.status = status_of(is_active=row.is_active, starts_at=row.starts_at, ends_at=row.ends_at)
    out.product_name = product_name
    out.category_name = category_name
    return out


def discount_detail(db: Session, row: Discount) -> DiscountAdminOut:
    """One rule with its target's display name (for the single-item routes)."""
    product_name = db.get(Product, row.product_id).name if row.product_id else None
    category_name = db.get(Category, row.category_id).name if row.category_id else None
    return discount_out(row, product_name, category_name)


def admin_list_discounts(
    db: Session,
    params: PaginationParams,
    *,
    q: str | None = None,
    status: str | None = None,
    scope: str | None = None,
) -> Page[DiscountAdminOut]:
    stmt = (
        select(Discount, Product.name, Category.name)
        .outerjoin(Product, Discount.product_id == Product.id)
        .outerjoin(Category, Discount.category_id == Category.id)
    )
    if scope is not None:
        stmt = stmt.where(Discount.scope == scope)
    if status is not None:
        stmt = stmt.where(_status_clause(Discount, status))
    if q and q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(Product.name.ilike(term), Category.name.ilike(term)))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(*DISCOUNT_SORTS.get(params.sort, DISCOUNT_SORTS["newest"]))
        .offset(params.offset)
        .limit(params.page_size)
    ).all()
    items = [discount_out(row, name, cat) for row, name, cat in rows]
    return Page[DiscountAdminOut](
        items=items,
        total=total,
        page=params.page,
        page_size=params.page_size,
        pages=_pages(total, params),
    )


def get_discount(db: Session, discount_id: int) -> Discount:
    discount = db.get(Discount, discount_id)
    if discount is None:
        raise NotFoundError("Discount not found")
    return discount


def _discount_values(payload: DiscountWrite, *, existing: Discount | None) -> dict:
    data = payload.model_dump(exclude_unset=True)
    if existing is None:
        missing = [field for field in ("scope", "kind", "value") if field not in data]
        if missing:
            raise AppError(
                "Please check the highlighted fields",
                details=[
                    {"field": field, "message": "This field is required"} for field in missing
                ],
            )
        values: dict = {
            "product_id": None,
            "category_id": None,
            "starts_at": None,
            "ends_at": None,
            "is_active": True,
        }
    else:
        values = {
            "scope": existing.scope.value,
            "kind": existing.kind.value,
            "value": float(existing.value),
            "product_id": existing.product_id,
            "category_id": existing.category_id,
            "starts_at": existing.starts_at,
            "ends_at": existing.ends_at,
            "is_active": existing.is_active,
        }
    values.update(data)
    return values


def _validated_discount(v: dict) -> dict:
    scope = v.get("scope")
    if scope is None:
        raise _field_error("Pick a scope", "scope")
    kind = v.get("kind")
    if kind is None:
        raise _field_error("Pick a discount type", "kind")

    if scope == "product":
        if v.get("product_id") is None:
            raise _field_error("Pick a product", "product_id")
        if v.get("category_id") is not None:
            raise _field_error("Leave the category empty for a product discount", "category_id")
    else:
        if v.get("category_id") is None:
            raise _field_error("Pick a category", "category_id")
        if v.get("product_id") is not None:
            raise _field_error("Leave the product empty for a category discount", "product_id")

    value = Decimal(str(v.get("value") if v.get("value") is not None else 0))
    if kind == "percent":
        if value <= 0 or value > 100:
            raise _field_error("Percent must be between 1 and 100", "value")
    elif value <= 0:
        raise _field_error("Discount must be greater than 0", "value")

    starts = _aware(v["starts_at"]) if v.get("starts_at") else None
    ends = _aware(v["ends_at"]) if v.get("ends_at") else None
    if starts is not None and ends is not None and starts >= ends:
        raise _field_error("End must be after start", "ends_at")

    v.update(scope=scope, kind=kind, value=value, starts_at=starts, ends_at=ends)
    return v


def _assert_target_exists(db: Session, v: dict) -> None:
    if v["scope"] == "product":
        if db.get(Product, v["product_id"]) is None:
            raise _field_error("That product no longer exists", "product_id")
    elif db.get(Category, v["category_id"]) is None:
        raise _field_error("That category no longer exists", "category_id")


def _windows_overlap(a_start, a_end, b_start, b_end) -> bool:
    """True when two windows share at least one instant (None = open-ended)."""
    left = a_start is None or b_end is None or _aware(a_start) < _aware(b_end)
    right = b_start is None or a_end is None or _aware(b_start) < _aware(a_end)
    return left and right


def _window_label(row: Discount) -> str:
    fmt = "%d %b %Y"
    if row.starts_at is None and row.ends_at is None:
        return "no time limit"
    if row.starts_at is None:
        return f"until {_aware(row.ends_at):{fmt}}"
    if row.ends_at is None:
        return f"from {_aware(row.starts_at):{fmt}}"
    return f"{_aware(row.starts_at):{fmt}} – {_aware(row.ends_at):{fmt}}"


def _assert_no_percent_overlap(db: Session, v: dict, *, exclude_id: int | None = None) -> None:
    """Sanity, not stacking: the engine never stacks, so two overlapping percent
    rules on the same target silently race and the loser is invisible to the
    admin — reject the pair instead."""
    if v["kind"] != "percent":
        return
    target = Discount.product_id if v["scope"] == "product" else Discount.category_id
    target_id = v["product_id"] if v["scope"] == "product" else v["category_id"]
    stmt = select(Discount).where(
        Discount.is_active.is_(True),
        Discount.kind == DiscountKind.PERCENT,
        Discount.scope == DiscountScope(v["scope"]),
        target == target_id,
    )
    if exclude_id is not None:
        stmt = stmt.where(Discount.id != exclude_id)
    for other in db.scalars(stmt):
        if _windows_overlap(other.starts_at, other.ends_at, v["starts_at"], v["ends_at"]):
            raise ConflictError(
                f"An overlapping percent discount already runs on this {v['scope']}",
                details=[
                    {
                        "field": "starts_at",
                        "message": f"Overlaps the percent discount running {_window_label(other)}",
                    }
                ],
            )


def create_discount(db: Session, payload: DiscountWrite) -> Discount:
    v = _validated_discount(_discount_values(payload, existing=None))
    _assert_target_exists(db, v)
    _assert_no_percent_overlap(db, v)
    discount = Discount(
        scope=DiscountScope(v["scope"]),
        kind=DiscountKind(v["kind"]),
        value=v["value"],
        product_id=v["product_id"],
        category_id=v["category_id"],
        starts_at=v["starts_at"],
        ends_at=v["ends_at"],
        is_active=v["is_active"],
    )
    db.add(discount)
    db.flush()
    return discount


def update_discount(db: Session, discount: Discount, payload: DiscountWrite) -> Discount:
    v = _validated_discount(_discount_values(payload, existing=discount))
    _assert_target_exists(db, v)
    _assert_no_percent_overlap(db, v, exclude_id=discount.id)

    discount.scope = DiscountScope(v["scope"])
    discount.kind = DiscountKind(v["kind"])
    discount.value = v["value"]
    discount.product_id = v["product_id"]
    discount.category_id = v["category_id"]
    discount.starts_at = v["starts_at"]
    discount.ends_at = v["ends_at"]
    discount.is_active = v["is_active"]
    db.flush()
    return discount


def delete_discount(db: Session, discount: Discount) -> None:
    db.delete(discount)
    db.flush()
