import json

from pydantic import Field
from sqlalchemy import Select, asc, desc, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import NotFoundError
from app.core.pagination import Page, PaginationParams
from app.core.redis import cache_delete_prefix, cache_get, cache_set
from app.modules.catalog.models import Brand, Category, Product, ProductVariant
from app.modules.catalog.schemas import (
    CategoryNode,
    ImageOut,
    ProductDetail,
    ProductFacets,
    ProductListItem,
    VariantOut,
    product_list_item,
)
from app.modules.inventory.models import Inventory

CATEGORY_CACHE = "catalog:categories"
PRODUCT_CACHE_TTL = 30

SORT_MAP = {
    "newest": (desc(Product.published_at), asc(Product.id)),
    "price_asc": None,  # set dynamically (min price subquery)
    "price_desc": None,
    "name_asc": asc(Product.name),
    "name_desc": desc(Product.name),
    "bestselling": None,
}
VALID_SORTS = set(SORT_MAP) | {"price_asc", "price_desc", "bestselling"}


class ProductQuery(PaginationParams):
    category: str | None = None
    brand: str | None = None
    q: str | None = None
    min_price: float | None = Field(default=None, ge=0)
    max_price: float | None = Field(default=None, ge=0)
    in_stock: bool = False
    featured: bool = False

    def normalized_sort(self) -> str:
        return self.sort if self.sort in VALID_SORTS else "newest"


def min_price_sq():
    return (
        select(func.min(ProductVariant.price))
        .where(ProductVariant.product_id == Product.id, ProductVariant.is_active.is_(True))
        .correlate(Product)
        .scalar_subquery()
    )


def available_sq():
    return (
        select(
            func.coalesce(func.sum(Inventory.quantity - Inventory.reserved), 0),
        )
        .select_from(Inventory)
        .join(ProductVariant, ProductVariant.id == Inventory.variant_id)
        .where(ProductVariant.product_id == Product.id, ProductVariant.is_active.is_(True))
        .correlate(Product)
        .scalar_subquery()
    )


def bestseller_sq():
    from app.modules.orders.models import Order, OrderItem, OrderStatus

    return (
        select(func.coalesce(func.sum(OrderItem.quantity), 0))
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            OrderItem.product_id == Product.id,
            Order.status != OrderStatus.CANCELLED,
        )
        .correlate(Product)
        .scalar_subquery()
    )


def category_ids_for(db: Session, slug: str) -> list[int] | None:
    root = db.scalar(select(Category).where(Category.slug == slug))
    if root is None:
        return None
    tree = category_tree(db)
    node = _find_node(tree, root.id)
    ids: list[int] = []
    stack = [node] if node else []
    while stack:
        current = stack.pop()
        ids.append(current.id)
        stack.extend(current.children)
    return ids


def _find_node(nodes: list[CategoryNode], category_id: int) -> CategoryNode | None:
    for node in nodes:
        if node.id == category_id:
            return node
        found = _find_node(node.children, category_id)
        if found:
            return found
    return None


def _base_filters(db: Session, params: ProductQuery) -> list:
    filters = [Product.is_active.is_(True)]
    if params.category:
        ids = category_ids_for(db, params.category)
        if ids is None:
            return [Product.id.is_(None)]
        filters.append(Product.category_id.in_(ids))
    if params.brand:
        filters.append(
            Product.brand_id.in_(select(Brand.id).where(Brand.slug == params.brand))
        )
    if params.q:
        needle = f"%{params.q.strip()}%"
        filters.append(or_(Product.name.ilike(needle), Product.description.ilike(needle)))
    if params.min_price is not None:
        filters.append(min_price_sq() >= params.min_price)
    if params.max_price is not None:
        filters.append(min_price_sq() <= params.max_price)
    if params.in_stock:
        filters.append(available_sq() > 0)
    if params.featured:
        filters.append(Product.is_featured.is_(True))
    return filters


def _sorted(stmt: Select, params: ProductQuery) -> Select:
    sort = params.normalized_sort()
    if sort == "price_asc":
        return stmt.order_by(asc(min_price_sq()), asc(Product.name))
    if sort == "price_desc":
        return stmt.order_by(desc(min_price_sq()), asc(Product.name))
    if sort == "bestselling":
        return stmt.order_by(desc(bestseller_sq()), desc(Product.published_at))
    return stmt.order_by(*SORT_MAP[sort])


def _list_options():
    return (
        selectinload(Product.brand),
        selectinload(Product.category),
        selectinload(Product.images),
        selectinload(Product.variants).selectinload(ProductVariant.inventory),
    )


def list_products(db: Session, params: ProductQuery) -> Page[ProductListItem]:
    filters = _base_filters(db, params)
    count_stmt = select(func.count()).select_from(Product).where(*filters)
    total = db.execute(count_stmt).scalar_one()

    stmt = _sorted(select(Product).where(*filters), params).options(*_list_options())
    rows = db.scalars(stmt.offset(params.offset).limit(params.page_size)).unique().all()

    items = []
    for product in rows:
        active = [v for v in product.variants if v.is_active]
        if not active:
            continue
        available = sum(v.inventory.available for v in active if v.inventory)
        price = min(v.price for v in active)
        compare = min(
            (v.compare_at_price for v in active if v.compare_at_price is not None),
            default=None,
        )
        items.append(
            product_list_item(
                product,
                available=available,
                thumbnail=product.images[0].url if product.images else None,
                price=price,
                compare_at=compare,
            )
        )

    pages = max((total + params.page_size - 1) // params.page_size, 1) if total else 1
    return Page[ProductListItem](
        items=items, total=total, page=params.page, page_size=params.page_size, pages=pages
    )


def product_facets(db: Session, params: ProductQuery) -> ProductFacets:
    filters = _base_filters(db, params)
    total = db.execute(
        select(func.count()).select_from(Product).where(*filters)
    ).scalar_one()

    brand_rows = db.execute(
        select(Brand.id, Brand.name, Brand.slug, func.count(Product.id))
        .join(Product, Product.brand_id == Brand.id)
        .where(*filters)
        .group_by(Brand.id, Brand.name, Brand.slug)
        .order_by(Brand.name)
    ).all()
    price_range = db.execute(
        select(func.min(min_price_sq()), func.max(min_price_sq())).select_from(Product).where(*filters)
    ).one()

    from app.modules.catalog.schemas import BrandOut

    return ProductFacets(
        brands=[BrandOut(id=r[0], name=r[1], slug=r[2]) for r in brand_rows],
        min_price=float(price_range[0]) if price_range[0] is not None else None,
        max_price=float(price_range[1]) if price_range[1] is not None else None,
        total=total,
    )


def get_product_detail(db: Session, slug: str) -> ProductDetail:
    cache_key = f"catalog:product:{slug}"
    cached = cache_get(cache_key)
    if cached:
        return ProductDetail.model_validate(json.loads(cached))

    product = db.scalar(
        select(Product)
        .where(Product.slug == slug, Product.is_active.is_(True))
        .options(
            selectinload(Product.brand),
            selectinload(Product.category).selectinload(Category.parent),
            selectinload(Product.images),
            selectinload(Product.variants).selectinload(ProductVariant.inventory),
        )
    )
    if product is None:
        raise NotFoundError("Product not found")

    active = [v for v in product.variants if v.is_active]
    if not active:
        raise NotFoundError("Product has no available options")

    variants = [
        VariantOut(
            id=v.id,
            name=v.name,
            sku=v.sku,
            attributes=v.attributes or {},
            price=float(v.price),
            compare_at_price=float(v.compare_at_price) if v.compare_at_price else None,
            is_default=v.is_default,
            available=v.inventory.available if v.inventory else 0,
        )
        for v in active
    ]
    prices = [v.price for v in active]
    detail = ProductDetail(
        id=product.id,
        name=product.name,
        slug=product.slug,
        description=product.description,
        brand=product.brand,
        category=CategoryNode.model_validate(product.category),
        images=[ImageOut.model_validate(img) for img in product.images],
        variants=variants,
        price=float(min(prices)),
        compare_at_price=float(min(p for p in (v.compare_at_price for v in active) if p))
        if any(v.compare_at_price for v in active)
        else None,
        in_stock=any(v.available > 0 for v in variants),
        available=sum(v.available for v in variants),
        is_featured=product.is_featured,
        created_at=product.published_at,
    )
    cache_set(cache_key, detail.model_dump_json(), PRODUCT_CACHE_TTL)
    return detail


def category_tree(db: Session) -> list[CategoryNode]:
    cached = cache_get(CATEGORY_CACHE)
    if cached:
        return [CategoryNode.model_validate(node) for node in json.loads(cached)]

    categories = db.scalars(
        select(Category)
        .where(Category.is_active.is_(True))
        .order_by(Category.position, Category.name)
    ).all()

    counts = dict(
        db.execute(
            select(Product.category_id, func.count(Product.id))
            .where(Product.is_active.is_(True))
            .group_by(Product.category_id)
        ).all()
    )

    nodes = {
        c.id: CategoryNode(
            id=c.id, name=c.name, slug=c.slug, parent_id=c.parent_id, image_url=c.image_url
        )
        for c in categories
    }
    roots: list[CategoryNode] = []
    for node in nodes.values():
        parent = nodes.get(node.parent_id) if node.parent_id else None
        if parent is None:
            roots.append(node)
        else:
            parent.children.append(node)

    def _total(node: CategoryNode) -> int:
        node.product_count = counts.get(node.id, 0) + sum(_total(c) for c in node.children)
        return node.product_count

    for root in roots:
        _total(root)

    cache_set(CATEGORY_CACHE, json.dumps([n.model_dump() for n in roots]), PRODUCT_CACHE_TTL)
    return roots


def invalidate_catalog_cache() -> None:
    cache_delete_prefix("catalog:")


def featured_products(db: Session, limit: int = 8) -> list[ProductListItem]:
    return _simple_list(db, [Product.is_featured.is_(True), Product.is_active.is_(True)], limit)


def best_selling_products(db: Session, limit: int = 8) -> list[ProductListItem]:
    return _simple_list(
        db,
        [Product.is_active.is_(True)],
        limit,
        order_by=(desc(bestseller_sq()), desc(Product.published_at)),
    )


def new_arrivals(db: Session, limit: int = 8) -> list[ProductListItem]:
    return _simple_list(
        db, [Product.is_active.is_(True)], limit, order_by=(desc(Product.published_at),)
    )


def _simple_list(
    db: Session, filters: list, limit: int = 8, order_by: tuple | None = None
) -> list[ProductListItem]:
    stmt = select(Product).where(*filters)
    stmt = stmt.order_by(*(order_by or (desc(Product.published_at),)))
    rows = db.scalars(stmt.limit(limit).options(*_list_options())).unique().all()
    items = []
    for product in rows:
        active = [v for v in product.variants if v.is_active]
        if not active:
            continue
        items.append(
            product_list_item(
                product,
                available=sum(v.inventory.available for v in active if v.inventory),
                thumbnail=product.images[0].url if product.images else None,
                price=min(v.price for v in active),
                compare_at=min(
                    (v.compare_at_price for v in active if v.compare_at_price),
                    default=None,
                ),
            )
        )
    return items
