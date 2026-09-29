from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ConflictError, NotFoundError
from app.core.pagination import Page, PaginationParams
from app.modules.catalog.models import Product, ProductVariant
from app.modules.inventory.models import Inventory, StockMovement


class StockAdjustment(BaseModel):
    variant_id: int
    delta: int = 0
    set_to: int | None = Field(default=None, ge=0)
    reason: str = Field(default="Manual adjustment", min_length=2, max_length=255)


class InventoryRow(BaseModel):
    variant_id: int
    sku: str
    variant_name: str
    product_id: int
    product_name: str
    price: float
    quantity: int
    reserved: int
    available: int
    low_stock_threshold: int
    updated_at: str


class InventoryQuery(PaginationParams):
    q: str | None = None
    low_stock: bool = False
    out_of_stock: bool = False


def ensure_inventory(db: Session, variant_id: int, initial: int = 0) -> Inventory:
    row = db.get(Inventory, variant_id)
    if row is None:
        row = Inventory(variant_id=variant_id, quantity=initial)
        db.add(row)
        db.flush()
    return row


def adjust_stock(db: Session, payload: StockAdjustment, actor_id: int) -> Inventory:
    """Lock the inventory row, apply the change, audit it - all in one transaction."""
    variant = db.get(ProductVariant, payload.variant_id)
    if variant is None:
        raise NotFoundError("Variant not found")

    inventory = db.execute(
        select(Inventory)
        .where(Inventory.variant_id == payload.variant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if inventory is None:
        inventory = Inventory(variant_id=payload.variant_id, quantity=0)
        db.add(inventory)
        db.flush()
        inventory = db.execute(
            select(Inventory)
            .where(Inventory.variant_id == payload.variant_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one()

    if payload.set_to is not None:
        new_quantity = payload.set_to
        reason = payload.reason or "Stock count reset"
    else:
        new_quantity = inventory.quantity + payload.delta
        reason = payload.reason
    if new_quantity < 0:
        raise ConflictError(
            f"Stock cannot go below 0 (current {inventory.quantity}, change {payload.delta})",
            details={"quantity": inventory.quantity},
        )

    delta = new_quantity - inventory.quantity
    inventory.quantity = new_quantity
    db.add(
        StockMovement(
            variant_id=inventory.variant_id,
            delta=delta,
            quantity_after=new_quantity,
            reason=reason,
            actor_id=actor_id,
        )
    )
    db.flush()
    return inventory


def list_inventory(db: Session, params: InventoryQuery) -> Page[InventoryRow]:
    filters = []
    if params.q:
        needle = f"%{params.q.strip()}%"
        filters.append(
            ProductVariant.sku.ilike(needle) | Product.name.ilike(needle)
        )

    base = (
        select(ProductVariant)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(*filters)
    )
    total = db.execute(
        select(func.count()).select_from(ProductVariant).join(
            Product, Product.id == ProductVariant.product_id
        ).where(*filters)
    ).scalar_one()

    sort = params.sort if params.sort in {"sku", "quantity", "product", "updated"} else "product"
    if sort == "sku":
        order = ProductVariant.sku.asc()
    elif sort == "quantity":
        order = Inventory.quantity.asc()
    elif sort == "updated":
        order = Inventory.updated_at.desc()
    else:
        order = Product.name.asc()

    rows = (
        db.execute(
            base.outerjoin(Inventory, Inventory.variant_id == ProductVariant.id)
            .order_by(order)
            .offset(params.offset)
            .limit(params.page_size)
        )
        .scalars()
        .unique()
        .all()
    )

    items: list[InventoryRow] = []
    for variant in rows:
        inv = variant.inventory
        available = inv.available if inv else 0
        if params.low_stock and available > (inv.low_stock_threshold if inv else 0):
            continue
        if params.out_of_stock and available > 0:
            continue
        items.append(
            InventoryRow(
                variant_id=variant.id,
                sku=variant.sku,
                variant_name=variant.name,
                product_id=variant.product.id,
                product_name=variant.product.name,
                price=float(variant.price),
                quantity=inv.quantity if inv else 0,
                reserved=inv.reserved if inv else 0,
                available=available,
                low_stock_threshold=inv.low_stock_threshold if inv else 5,
                updated_at=inv.updated_at.isoformat() if inv and inv.updated_at else "",
            )
        )

    total_out = len(items) if (params.low_stock or params.out_of_stock) else total
    pages = max((total_out + params.page_size - 1) // params.page_size, 1) if total_out else 1
    return Page[InventoryRow](
        items=items, total=total_out, page=params.page, page_size=params.page_size, pages=pages
    )


def validate_stock_available(variants: dict[int, ProductVariant], required: dict[int, int]) -> None:
    missing = [vid for vid in required if vid not in variants]
    if missing:
        raise AppError("Some cart items are no longer available", details={"variants": missing})
