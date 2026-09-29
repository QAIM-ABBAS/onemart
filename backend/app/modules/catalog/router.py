from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.pagination import Page
from app.modules.catalog import service
from app.modules.catalog.models import Brand
from app.modules.catalog.schemas import (
    BrandOut,
    CategoryNode,
    ProductDetail,
    ProductFacets,
    ProductListItem,
)
from app.modules.orders.payment import payment_registry
from app.modules.orders.schemas import PaymentMethodInfo

router = APIRouter(tags=["catalog"])


@router.get("/categories", response_model=list[CategoryNode])
def categories(db: Session = Depends(get_db)):
    return service.category_tree(db)


@router.get("/brands", response_model=list[BrandOut])
def brands(db: Session = Depends(get_db)):
    return db.scalars(select(Brand).where(Brand.is_active.is_(True)).order_by(Brand.name)).all()


@router.get("/home")
def home(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=30"
    return {
        "categories": service.category_tree(db)[:8],
        "featured": service.featured_products(db, 8),
        "best_sellers": service.best_selling_products(db, 8),
        "new_arrivals": service.new_arrivals(db, 8),
    }


@router.get("/products", response_model=Page[ProductListItem])
def list_products(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: str = "newest",
    category: str | None = None,
    brand: str | None = None,
    q: str | None = None,
    min_price: float | None = Query(None, ge=0),
    max_price: float | None = Query(None, ge=0),
    in_stock: bool = False,
    featured: bool = False,
):
    params = service.ProductQuery(
        page=page,
        page_size=page_size,
        sort=sort,
        category=category,
        brand=brand,
        q=q,
        min_price=min_price,
        max_price=max_price,
        in_stock=in_stock,
        featured=featured,
    )
    return service.list_products(db, params)


@router.get("/products/facets", response_model=ProductFacets)
def facets(
    db: Session = Depends(get_db),
    category: str | None = None,
    brand: str | None = None,
    q: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    in_stock: bool = False,
    featured: bool = False,
):
    params = service.ProductQuery(
        category=category, brand=brand, q=q, min_price=min_price,
        max_price=max_price, in_stock=in_stock, featured=featured,
    )
    return service.product_facets(db, params)


@router.get("/products/{slug}", response_model=ProductDetail)
def product_detail(slug: str, db: Session = Depends(get_db)):
    return service.get_product_detail(db, slug)


@router.get("/payment-methods", response_model=list[PaymentMethodInfo])
def payment_methods():
    return [
        PaymentMethodInfo(code=code, name=payment_registry.get(code).display_name)
        for code in payment_registry.codes
    ]
