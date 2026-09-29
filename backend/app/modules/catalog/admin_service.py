import re
import unicodedata

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ConflictError, NotFoundError
from app.modules.catalog.models import Brand, Category, Product, ProductImage, ProductVariant
from app.modules.catalog.schemas import BrandWrite, CategoryWrite, ProductWrite
from app.modules.inventory.service import ensure_inventory


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "item"


def unique_slug(db: Session, model, base: str, exclude_id: int | None = None) -> str:
    slug = base
    suffix = 2
    while True:
        stmt = select(model.id).where(model.slug == slug)
        if exclude_id:
            stmt = stmt.where(model.id != exclude_id)
        if db.scalar(stmt) is None:
            return slug
        slug = f"{base}-{suffix}"
        suffix += 1


def _require_category(db: Session, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise AppError("Category does not exist", details={"category_id": category_id})
    return category


def create_product(db: Session, payload: ProductWrite) -> Product:
    _require_category(db, payload.category_id)
    if payload.brand_id is not None and db.get(Brand, payload.brand_id) is None:
        raise AppError("Brand does not exist", details={"brand_id": payload.brand_id})

    product = Product(
        name=payload.name.strip(),
        slug=unique_slug(db, Product, slugify(payload.name)),
        category_id=payload.category_id,
        brand_id=payload.brand_id,
        description=payload.description,
        is_active=payload.is_active,
        is_featured=payload.is_featured,
    )
    db.add(product)
    db.flush()

    for index, variant in enumerate(payload.variants):
        if db.scalar(select(ProductVariant.id).where(ProductVariant.sku == variant.sku)):
            raise ConflictError(f"SKU '{variant.sku}' is already in use")
        row = ProductVariant(
            product_id=product.id,
            sku=variant.sku,
            name=variant.name,
            attributes=variant.attributes,
            price=variant.price,
            compare_at_price=variant.compare_at_price,
            is_default=variant.is_default,
            is_active=variant.is_active,
            position=variant.position or index,
        )
        db.add(row)
        db.flush()
        ensure_inventory(db, row.id, variant.initial_stock or 0)

    for index, image in enumerate(payload.images):
        db.add(
            ProductImage(
                product_id=product.id, url=image.url, alt=image.alt, position=image.position or index
            )
        )
    db.flush()
    return product


def update_product(db: Session, product: Product, payload: ProductWrite) -> Product:
    _require_category(db, payload.category_id)
    if payload.brand_id is not None and db.get(Brand, payload.brand_id) is None:
        raise AppError("Brand does not exist", details={"brand_id": payload.brand_id})

    previous_name = product.name
    product.name = payload.name.strip()
    if product.name != previous_name:
        product.slug = unique_slug(db, Product, slugify(payload.name), exclude_id=product.id)
    product.category_id = payload.category_id
    product.brand_id = payload.brand_id
    product.description = payload.description
    product.is_active = payload.is_active
    product.is_featured = payload.is_featured

    kept_ids: set[int] = set()
    seen_skus: set[str] = set()
    for index, variant in enumerate(payload.variants):
        if variant.sku in seen_skus:
            raise ConflictError(f"Duplicate SKU '{variant.sku}' in this product")
        seen_skus.add(variant.sku)

        row = None
        if variant.id is not None:
            row = db.scalar(
                select(ProductVariant).where(
                    ProductVariant.id == variant.id, ProductVariant.product_id == product.id
                )
            )
        if row is None:
            row = db.scalar(
                select(ProductVariant).where(
                    ProductVariant.product_id == product.id, ProductVariant.sku == variant.sku
                )
            )
        is_new = False
        if row is None:
            if db.scalar(select(ProductVariant.id).where(ProductVariant.sku == variant.sku)):
                raise ConflictError(f"SKU '{variant.sku}' is already in use")
            row = ProductVariant(product_id=product.id, sku=variant.sku)
            db.add(row)
            is_new = True

        row.name = variant.name
        row.attributes = variant.attributes
        row.price = variant.price
        row.compare_at_price = variant.compare_at_price
        row.is_default = variant.is_default
        row.is_active = variant.is_active
        row.position = variant.position or index

        if is_new:
            db.flush()
            ensure_inventory(db, row.id, variant.initial_stock or 0)
        kept_ids.add(row.id)

    if not any(v.is_default for v in payload.variants):
        first = db.scalar(
            select(ProductVariant)
            .where(ProductVariant.product_id == product.id)
            .order_by(ProductVariant.position)
            .limit(1)
        )
        if first:
            first.is_default = True

    missing = db.scalars(
        select(ProductVariant).where(
            ProductVariant.product_id == product.id, ProductVariant.id.not_in(kept_ids)
        )
    ).all()
    for row in missing:
        row.is_active = False

    for image in list(product.images):
        db.delete(image)
    db.flush()
    for index, image in enumerate(payload.images):
        db.add(
            ProductImage(
                product_id=product.id, url=image.url, alt=image.alt, position=image.position or index
            )
        )
    db.flush()
    return product


def delete_product(db: Session, product: Product) -> None:
    db.delete(product)
    db.flush()


def get_product(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise NotFoundError("Product not found")
    return product


def create_category(db: Session, payload: CategoryWrite) -> Category:
    if payload.parent_id is not None and db.get(Category, payload.parent_id) is None:
        raise AppError("Parent category does not exist")
    category = Category(
        name=payload.name.strip(),
        slug=unique_slug(db, Category, slugify(payload.name)),
        parent_id=payload.parent_id,
        position=payload.position,
        is_active=payload.is_active,
        image_url=payload.image_url,
    )
    db.add(category)
    db.flush()
    return category


def update_category(db: Session, category: Category, payload: CategoryWrite) -> Category:
    if payload.parent_id is not None:
        if payload.parent_id == category.id:
            raise AppError("A category cannot be its own parent")
        if db.get(Category, payload.parent_id) is None:
            raise AppError("Parent category does not exist")
        if _is_descendant(db, category.id, payload.parent_id):
            raise AppError("Cannot move a category under one of its own children")
    category.name = payload.name.strip()
    category.parent_id = payload.parent_id
    category.position = payload.position
    category.is_active = payload.is_active
    category.image_url = payload.image_url
    db.flush()
    return category


def delete_category(db: Session, category: Category) -> None:
    child_count = db.scalar(
        select(func.count()).select_from(Category).where(Category.parent_id == category.id)
    )
    product_count = db.scalar(
        select(func.count()).select_from(Product).where(Product.category_id == category.id)
    )
    if child_count:
        raise ConflictError("Move or delete this category's subcategories first")
    if product_count:
        raise ConflictError("Reassign products before deleting this category")
    db.delete(category)
    db.flush()


def _is_descendant(db: Session, ancestor_id: int, node_id: int) -> bool:
    nodes = db.execute(select(Category.id, Category.parent_id)).all()
    parents = {n[0]: n[1] for n in nodes}
    current = node_id
    while current is not None:
        if current == ancestor_id:
            return True
        current = parents.get(current)
    return False


def get_category(db: Session, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise NotFoundError("Category not found")
    return category


def create_brand(db: Session, payload: BrandWrite) -> Brand:
    name = payload.name.strip()
    if db.scalar(select(Brand.id).where(func.lower(Brand.name) == name.lower())):
        raise ConflictError("Brand already exists")
    brand = Brand(name=name, slug=unique_slug(db, Brand, slugify(name)))
    db.add(brand)
    db.flush()
    return brand
