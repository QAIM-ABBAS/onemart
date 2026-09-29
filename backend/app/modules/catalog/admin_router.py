from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.core.deps import get_current_staff
from app.core.exceptions import NotFoundError
from app.core.pagination import Page
from app.modules.catalog import admin_service, service
from app.modules.catalog.models import Brand, Category, Product, ProductVariant
from app.modules.catalog.schemas import (
    BrandOut,
    BrandWrite,
    CategoryNode,
    CategoryWrite,
    ProductAdminOut,
    ProductWrite,
)
from app.modules.users.models import User

router = APIRouter(prefix="/admin", tags=["admin-catalog"])


def _product_options():
    return (
        selectinload(Product.brand),
        selectinload(Product.category),
        selectinload(Product.images),
        selectinload(Product.variants).selectinload(ProductVariant.inventory),
    )


@router.get("/products", response_model=Page[ProductAdminOut])
def admin_list_products(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: str = "newest",
    q: str | None = None,
    category: str | None = None,
    brand: str | None = None,
    active: bool | None = None,
):
    filters = []
    if q:
        needle = f"%{q.strip()}%"
        filters.append(Product.name.ilike(needle) | ProductVariant.sku.ilike(needle))
    if category:
        ids = service.category_ids_for(db, category)
        filters.append(Product.category_id.in_(ids or []))
    if brand:
        filters.append(Product.brand_id.in_(select(Brand.id).where(Brand.slug == brand)))
    if active is not None:
        filters.append(Product.is_active.is_(active))

    needs_variant_join = bool(q)
    count_stmt = select(func.count(distinct(Product.id))).select_from(Product)
    rows_stmt = select(Product)
    if needs_variant_join:
        count_stmt = count_stmt.join(
            ProductVariant, ProductVariant.product_id == Product.id
        )
        rows_stmt = rows_stmt.join(
            ProductVariant, ProductVariant.product_id == Product.id
        ).distinct()
    total = db.execute(count_stmt.where(*filters)).scalar_one()

    order_map = {
        "newest": Product.published_at.desc(),
        "oldest": Product.published_at.asc(),
        "name_asc": Product.name.asc(),
        "name_desc": Product.name.desc(),
        "updated": Product.updated_at.desc(),
    }
    stmt = (
        rows_stmt.where(*filters)
        .order_by(order_map.get(sort, order_map["newest"]), Product.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .options(*_product_options())
    )
    rows = db.scalars(stmt).unique().all()

    items = []
    for product in rows:
        active_variants = [v for v in product.variants if v.is_active] or list(product.variants)
        prices = [v.price for v in active_variants]
        item = ProductAdminOut(
            id=product.id,
            name=product.name,
            slug=product.slug,
            brand=product.brand.name if product.brand else None,
            category=product.category.name,
            category_slug=product.category.slug,
            thumbnail=product.images[0].url if product.images else None,
            price=float(min(prices)) if prices else 0.0,
            compare_at_price=None,
            in_stock=any(
                v.inventory and v.inventory.available > 0 for v in product.variants
            ),
            available=sum(
                v.inventory.available for v in product.variants if v.inventory
            ),
            variant_count=len(product.variants),
            is_featured=product.is_featured,
            created_at=product.published_at,
            description=product.description,
            category_id=product.category_id,
            brand_id=product.brand_id,
            updated_at=product.updated_at,
            is_active=product.is_active,
            variants=[
                {
                    "id": v.id,
                    "name": v.name,
                    "sku": v.sku,
                    "attributes": v.attributes or {},
                    "price": float(v.price),
                    "compare_at_price": float(v.compare_at_price) if v.compare_at_price else None,
                    "is_default": v.is_default,
                    "is_active": v.is_active,
                    "available": v.inventory.available if v.inventory else 0,
                }
                for v in product.variants
            ],
            images=[{"id": img.id, "url": img.url, "alt": img.alt} for img in product.images],
        )
        items.append(item)

    pages = max((total + page_size - 1) // page_size, 1) if total else 1
    return Page[ProductAdminOut](
        items=items, total=total, page=page, page_size=page_size, pages=pages
    )


@router.post("/products", response_model=ProductAdminOut, status_code=201)
def admin_create_product(
    payload: ProductWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    product = admin_service.create_product(db, payload)
    db.commit()
    service.invalidate_catalog_cache()
    return admin_service_product(db, product.id)


@router.get("/products/{product_id}", response_model=ProductAdminOut)
def admin_get_product(
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    return admin_service_product(db, product_id)


@router.patch("/products/{product_id}", response_model=ProductAdminOut)
def admin_update_product(
    product_id: int,
    payload: ProductWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    product = admin_service.get_product(db, product_id)
    admin_service.update_product(db, product, payload)
    db.commit()
    service.invalidate_catalog_cache()
    return admin_service_product(db, product.id)


@router.delete("/products/{product_id}", status_code=204)
def admin_delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    product = admin_service.get_product(db, product_id)
    admin_service.delete_product(db, product)
    db.commit()
    service.invalidate_catalog_cache()
    return Response(status_code=204)


def admin_service_product(db: Session, product_id: int) -> ProductAdminOut:
    product = db.scalar(
        select(Product).where(Product.id == product_id).options(*_product_options())
    )
    if product is None:
        raise NotFoundError("Product not found")
    db.refresh(product, ["variants", "images", "brand", "category"])
    active_variants = [v for v in product.variants if v.is_active] or list(product.variants)
    prices = [v.price for v in active_variants]
    return ProductAdminOut(
        id=product.id,
        name=product.name,
        slug=product.slug,
        brand=product.brand.name if product.brand else None,
        category=product.category.name,
        category_slug=product.category.slug,
        thumbnail=product.images[0].url if product.images else None,
        price=float(min(prices)) if prices else 0.0,
        compare_at_price=None,
        in_stock=any(v.inventory and v.inventory.available > 0 for v in product.variants),
        available=sum(v.inventory.available for v in product.variants if v.inventory),
        variant_count=len(product.variants),
        is_featured=product.is_featured,
        created_at=product.published_at,
        description=product.description,
        category_id=product.category_id,
        brand_id=product.brand_id,
        updated_at=product.updated_at,
        is_active=product.is_active,
        variants=[
            {
                "id": v.id,
                "name": v.name,
                "sku": v.sku,
                "attributes": v.attributes or {},
                "price": float(v.price),
                "compare_at_price": float(v.compare_at_price) if v.compare_at_price else None,
                "is_default": v.is_default,
                "is_active": v.is_active,
                "available": v.inventory.available if v.inventory else 0,
            }
            for v in product.variants
        ],
        images=[{"id": img.id, "url": img.url, "alt": img.alt} for img in product.images],
    )


@router.get("/categories", response_model=list[CategoryNode])
def admin_categories(db: Session = Depends(get_db), _: User = Depends(get_current_staff)):
    return service.category_tree(db)


@router.get("/categories/flat", response_model=list[CategoryNode])
def admin_categories_flat(db: Session = Depends(get_db), _: User = Depends(get_current_staff)):
    """Flattened (id, name, parent_id) list for admin tables."""
    rows = db.scalars(select(Category).order_by(Category.name)).all()
    return [
        CategoryNode(
            id=c.id,
            name=c.name,
            slug=c.slug,
            parent_id=c.parent_id,
            image_url=c.image_url,
            is_active=c.is_active,
        )
        for c in rows
    ]


@router.post("/categories", response_model=CategoryNode, status_code=201)
def admin_create_category(
    payload: CategoryWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    category = admin_service.create_category(db, payload)
    db.commit()
    service.invalidate_catalog_cache()
    return category


@router.patch("/categories/{category_id}", response_model=CategoryNode)
def admin_update_category(
    category_id: int,
    payload: CategoryWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    category = admin_service.get_category(db, category_id)
    admin_service.update_category(db, category, payload)
    db.commit()
    service.invalidate_catalog_cache()
    return category


@router.delete("/categories/{category_id}", status_code=204)
def admin_delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    category = admin_service.get_category(db, category_id)
    admin_service.delete_category(db, category)
    db.commit()
    service.invalidate_catalog_cache()
    return Response(status_code=204)


@router.get("/brands", response_model=list[BrandOut])
def admin_brands(db: Session = Depends(get_db), _: User = Depends(get_current_staff)):
    return db.scalars(select(Brand).order_by(Brand.name)).all()


@router.post("/brands", response_model=BrandOut, status_code=201)
def admin_create_brand(
    payload: BrandWrite,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_staff),
):
    brand = admin_service.create_brand(db, payload)
    db.commit()
    service.invalidate_catalog_cache()
    return brand
