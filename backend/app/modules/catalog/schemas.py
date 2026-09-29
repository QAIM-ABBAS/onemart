from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.modules.catalog.models import Product


def money(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


class CategoryNode(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    parent_id: int | None = None
    image_url: str | None = None
    is_active: bool = True
    product_count: int = 0
    children: list["CategoryNode"] = []


class BrandOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str


class VariantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sku: str
    attributes: dict
    price: float
    compare_at_price: float | None = None
    is_default: bool
    available: int = 0
    is_active: bool = True

    @field_validator("price", "compare_at_price", mode="before")
    @classmethod
    def _price(cls, v):
        return money(v) if isinstance(v, Decimal) else v


class ImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    alt: str = ""


class ProductListItem(BaseModel):
    id: int
    name: str
    slug: str
    brand: str | None = None
    category: str
    category_slug: str
    thumbnail: str | None = None
    price: float
    compare_at_price: float | None = None
    in_stock: bool
    available: int
    variant_count: int
    is_featured: bool = False
    created_at: datetime


class ProductDetail(BaseModel):
    id: int
    name: str
    slug: str
    description: str
    brand: BrandOut | None = None
    category: CategoryNode
    images: list[ImageOut]
    variants: list[VariantOut]
    price: float
    compare_at_price: float | None = None
    in_stock: bool
    available: int
    is_featured: bool
    created_at: datetime


class ProductFacets(BaseModel):
    brands: list[BrandOut] = []
    min_price: float | None = None
    max_price: float | None = None
    total: int = 0


class VariantIn(BaseModel):
    id: int | None = None
    sku: str = Field(min_length=2, max_length=64)
    name: str = Field(default="Default", min_length=1, max_length=120)
    attributes: dict = Field(default_factory=dict)
    price: float = Field(gt=0)
    compare_at_price: float | None = Field(default=None, gt=0)
    is_default: bool = False
    is_active: bool = True
    position: int = 0
    initial_stock: int | None = Field(default=None, ge=0)


class ImageIn(BaseModel):
    id: int | None = None
    url: str = Field(min_length=1, max_length=500)
    alt: str = ""
    position: int = 0


class ProductWrite(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    category_id: int
    brand_id: int | None = None
    description: str = ""
    is_active: bool = True
    is_featured: bool = False
    variants: list[VariantIn] = Field(min_length=1)
    images: list[ImageIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def _one_default(self):
        if sum(1 for v in self.variants if v.is_default) > 1:
            raise ValueError("Only one variant can be the default")
        if not any(v.is_default for v in self.variants):
            self.variants[0].is_default = True
        return self


class ProductAdminOut(ProductListItem):
    model_config = ConfigDict(from_attributes=True)

    description: str
    category_id: int
    brand_id: int | None = None
    updated_at: datetime
    is_active: bool = True
    variants: list[VariantOut] = []
    images: list[ImageOut] = []


class CategoryWrite(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    parent_id: int | None = None
    position: int = 0
    is_active: bool = True
    image_url: str | None = None


class BrandWrite(BaseModel):
    name: str = Field(min_length=2, max_length=120)


def product_list_item(
    product: Product,
    available: int,
    thumbnail: str | None,
    price: Decimal,
    compare_at: Decimal | None,
) -> ProductListItem:
    return ProductListItem(
        id=product.id,
        name=product.name,
        slug=product.slug,
        brand=product.brand.name if product.brand else None,
        category=product.category.name,
        category_slug=product.category.slug,
        thumbnail=thumbnail,
        price=float(price),
        compare_at_price=float(compare_at) if compare_at is not None else None,
        in_stock=available > 0,
        available=available,
        variant_count=len(product.variants),
        is_featured=product.is_featured,
        created_at=product.published_at,
    )
