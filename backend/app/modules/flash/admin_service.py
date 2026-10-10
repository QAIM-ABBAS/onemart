"""Admin-side flash-deal work: deal CRUD, item management, variant search.

The pricing/claim primitives live in :mod:`.service` because checkout and the
public strip use them too; this file only adds the staff-facing shapes and
keeps the shared payload cache honest after every change.
"""

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.core.pagination import Page, PaginationParams
from app.modules.catalog.models import Product, ProductVariant
from app.modules.discounts.pricing import HUNDRED, ZERO, money
from app.modules.flash.models import FlashDeal, FlashDealItem
from app.modules.flash.schemas import (
    DealAdminOut,
    DealItemAdminOut,
    DealItemWrite,
    DealWrite,
    VariantSearchRow,
)
from app.modules.flash.service import deal_unit_price, invalidate_flash_cache


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def deal_status(deal: FlashDeal, now: datetime) -> str:
    if not deal.is_active:
        return "inactive"
    starts_at, ends_at = _aware(deal.starts_at), _aware(deal.ends_at)
    if ends_at is not None and now >= ends_at:
        return "ended"
    if starts_at is not None and now < starts_at:
        return "scheduled"
    return "live"


def get_deal(db: Session, deal_id: int) -> FlashDeal:
    deal = db.get(FlashDeal, deal_id)
    if deal is None:
        raise NotFoundError("Flash deal not found")
    return deal


def admin_out(db: Session, deal: FlashDeal, now: datetime) -> DealAdminOut:
    sold, limit = db.execute(
        select(
            func.coalesce(func.sum(FlashDealItem.deal_stock_sold), 0),
            func.coalesce(func.sum(FlashDealItem.deal_stock_limit), 0),
        ).where(FlashDealItem.deal_id == deal.id)
    ).one()
    return DealAdminOut(
        id=deal.id,
        name=deal.name,
        starts_at=deal.starts_at,
        ends_at=deal.ends_at,
        is_active=deal.is_active,
        status=deal_status(deal, now),
        item_count=len(deal.items),
        stock_sold=int(sold),
        stock_limit=int(limit),
        created_at=deal.created_at,
    )


def _pages(total: int, params: PaginationParams) -> int:
    return max((total + params.page_size - 1) // params.page_size, 1)


def list_deals(
    db: Session,
    params: PaginationParams,
    *,
    q: str | None = None,
    status: str | None = None,
) -> Page[DealAdminOut]:
    now = datetime.now(UTC)
    filters = []
    if q:
        filters.append(FlashDeal.name.ilike(f"%{q.strip()}%"))
    if status == "live":
        filters.extend(
            [
                FlashDeal.is_active.is_(True),
                (FlashDeal.starts_at.is_(None) | (FlashDeal.starts_at <= now)),
                (FlashDeal.ends_at.is_(None) | (FlashDeal.ends_at > now)),
            ]
        )
    elif status == "scheduled":
        filters.extend(
            [
                FlashDeal.is_active.is_(True),
                FlashDeal.starts_at.is_not(None),
                FlashDeal.starts_at > now,
            ]
        )
    elif status == "ended":
        filters.append(
            FlashDeal.ends_at.is_not(None) & (FlashDeal.ends_at <= now)
        )
    elif status == "inactive":
        filters.append(FlashDeal.is_active.is_(False))

    total = db.execute(select(func.count()).select_from(FlashDeal).where(*filters)).scalar_one()

    sort_map = {
        "newest": FlashDeal.created_at.desc(),
        "oldest": FlashDeal.created_at.asc(),
        "name": FlashDeal.name.asc(),
        "ending": FlashDeal.ends_at.asc().nulls_last(),
    }
    rows = db.scalars(
        select(FlashDeal)
        .where(*filters)
        .order_by(sort_map.get(params.sort, sort_map["newest"]))
        .offset(params.offset)
        .limit(params.page_size)
    ).all()
    items = [admin_out(db, deal, now) for deal in rows]
    return Page[DealAdminOut](
        items=items, total=total, page=params.page, page_size=params.page_size,
        pages=_pages(total, params),
    )


def create_deal(db: Session, payload: DealWrite) -> FlashDeal:
    deal = FlashDeal(**payload.model_dump())
    db.add(deal)
    db.flush()
    invalidate_flash_cache()
    return deal


def update_deal(db: Session, deal: FlashDeal, payload: DealWrite) -> FlashDeal:
    for key, value in payload.model_dump().items():
        setattr(deal, key, value)
    db.flush()
    invalidate_flash_cache()
    return deal


def delete_deal(db: Session, deal: FlashDeal) -> None:
    db.delete(deal)
    db.flush()
    invalidate_flash_cache()


def end_early(db: Session, deal: FlashDeal) -> FlashDeal:
    """Pull the end time back to now — the deal stops selling immediately
    while its history (sold counters, orders) stays intact."""
    deal.ends_at = datetime.now(UTC)
    deal.is_active = True  # "ended by time", not "disabled"
    db.flush()
    invalidate_flash_cache()
    return deal


def _item_out(item: FlashDealItem, variant: ProductVariant) -> DealItemAdminOut:
    list_price = money(variant.price)
    effective = deal_unit_price(item, list_price)
    # HUNDRED first: int / int would be a float and float * Decimal raises.
    claimed = money(
        HUNDRED * item.deal_stock_sold / item.deal_stock_limit
        if item.deal_stock_limit
        else ZERO
    )
    return DealItemAdminOut(
        id=item.id,
        deal_id=item.deal_id,
        variant_id=item.variant_id,
        product_name=variant.product.name,
        product_slug=variant.product.slug,
        variant_name=variant.name,
        sku=variant.sku,
        list_price=float(list_price),
        deal_price=float(item.deal_price) if item.deal_price is not None else None,
        deal_percent=float(item.deal_percent) if item.deal_percent is not None else None,
        effective_price=float(effective),
        stock_limit=item.deal_stock_limit,
        stock_sold=item.deal_stock_sold,
        remaining=max(item.deal_stock_limit - item.deal_stock_sold, 0),
        claimed_percent=float(claimed),
        per_user_limit=item.per_user_limit,
    )


def list_items(db: Session, deal: FlashDeal) -> list[DealItemAdminOut]:
    rows = db.execute(
        select(FlashDealItem, ProductVariant)
        .join(ProductVariant, ProductVariant.id == FlashDealItem.variant_id)
        .where(FlashDealItem.deal_id == deal.id)
        .order_by(FlashDealItem.id)
    ).all()
    return [_item_out(item, variant) for item, variant in rows]


def add_item(db: Session, deal: FlashDeal, payload: DealItemWrite) -> FlashDealItem:
    variant = db.get(ProductVariant, payload.variant_id)
    if variant is None:
        raise NotFoundError("Variant not found")

    list_price = money(variant.price)
    if payload.deal_price is not None and money(payload.deal_price) >= list_price:
        raise ConflictError(
            f"The deal price must be below the list price ({list_price})"
        )

    exists = db.scalar(
        select(func.count())
        .select_from(FlashDealItem)
        .where(
            FlashDealItem.deal_id == deal.id,
            FlashDealItem.variant_id == payload.variant_id,
        )
    )
    if exists:
        raise ConflictError("That variant is already in this deal")

    item = FlashDealItem(
        deal_id=deal.id,
        variant_id=payload.variant_id,
        deal_price=money(payload.deal_price) if payload.deal_price is not None else None,
        deal_percent=payload.deal_percent,
        deal_stock_limit=payload.deal_stock_limit,
        per_user_limit=payload.per_user_limit,
    )
    db.add(item)
    db.flush()
    invalidate_flash_cache()
    return item


def update_item(db: Session, item: FlashDealItem, payload: DealItemWrite) -> FlashDealItem:
    """Price/limit changes only — ``deal_stock_sold`` is the checkout's
    counter and is never written from here. The limit may drop below what is
    already sold (that just closes the deal), never below zero."""
    variant = db.get(ProductVariant, payload.variant_id)
    if variant is None or payload.variant_id != item.variant_id:
        raise ConflictError("Changing an item's variant — remove and re-add it")
    list_price = money(variant.price)
    if payload.deal_price is not None and money(payload.deal_price) >= list_price:
        raise ConflictError(
            f"The deal price must be below the list price ({list_price})"
        )
    item.deal_price = money(payload.deal_price) if payload.deal_price is not None else None
    item.deal_percent = payload.deal_percent
    item.deal_stock_limit = payload.deal_stock_limit
    item.per_user_limit = payload.per_user_limit
    db.flush()
    invalidate_flash_cache()
    return item


def delete_item(db: Session, item: FlashDealItem) -> None:
    db.delete(item)
    db.flush()
    invalidate_flash_cache()


def variant_search(
    db: Session, params: PaginationParams, *, q: str | None = None
) -> Page[VariantSearchRow]:
    """Variants with their product, for the add-item dialog; flags ones a
    live deal already claims so staff can see the clash before adding."""
    filters = [ProductVariant.is_active.is_(True), Product.is_active.is_(True)]
    if q:
        needle = f"%{q.strip()}%"
        filters.append(
            Product.name.ilike(needle) | ProductVariant.sku.ilike(needle)
        )

    total = db.execute(
        select(func.count())
        .select_from(ProductVariant)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(*filters)
    ).scalar_one()

    now = datetime.now(UTC)
    rows = db.execute(
        select(ProductVariant, Product)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(*filters)
        .order_by(Product.name, ProductVariant.position)
        .offset(params.offset)
        .limit(params.page_size)
    ).all()

    live_claims = dict(
        db.execute(
            select(FlashDealItem.variant_id, FlashDeal.name)
            .join(FlashDeal, FlashDeal.id == FlashDealItem.deal_id)
            .where(
                FlashDeal.is_active.is_(True),
                (FlashDeal.ends_at.is_(None) | (FlashDeal.ends_at > now)),
            )
        ).all()
    )

    items = [
        VariantSearchRow(
            variant_id=variant.id,
            product_id=product.id,
            product_name=product.name,
            product_slug=product.slug,
            variant_name=variant.name,
            sku=variant.sku,
            price=float(money(variant.price)),
            image_url=product.images[0].url if product.images else None,
            in_live_deal=live_claims.get(variant.id),
        )
        for variant, product in rows
    ]
    return Page[VariantSearchRow](
        items=items, total=total, page=params.page, page_size=params.page_size,
        pages=_pages(total, params),
    )
