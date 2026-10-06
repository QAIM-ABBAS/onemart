from fastapi import Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import AppError, ConflictError, NotFoundError
from app.modules.cart.models import Cart, CartItem
from app.modules.cart.schemas import CartItemOut, CartOut, price
from app.modules.discounts import service as discounts_service
from app.modules.discounts.pricing import money
from app.modules.discounts.schemas import CouponOut
from app.modules.inventory.models import Inventory
from app.modules.users.models import User

CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30


def _set_cart_cookie(response: Response, session_key: str) -> None:
    response.set_cookie(
        settings.cart_cookie_name,
        session_key,
        max_age=CART_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def clear_cart_cookie(response: Response) -> None:
    response.delete_cookie(settings.cart_cookie_name, path="/")


def resolve_cart(db: Session, request: Request, response: Response, user: User | None) -> Cart:
    """Return the caller's cart, creating it if needed.

    Authenticated callers own a cart keyed by user_id; guests own one keyed by the
    httpOnly session cookie.
    """
    if user is not None:
        cart = db.scalar(select(Cart).where(Cart.user_id == user.id))
        guest = _guest_cart(db, request)
        if guest is not None:
            if cart is None:
                cart = guest
                cart.user_id = user.id
                cart.session_key = None
            else:
                # Carry the guest's coupon across; the guest row is deleted
                # below, and losing the code on login would be a nasty surprise.
                if (source_coupon := guest.coupon) and cart.coupon is None:
                    cart.coupon = source_coupon
                _merge_items(db, source=guest, target=cart)
                db.delete(guest)
            db.flush()
            clear_cart_cookie(response)
        if cart is None:
            cart = Cart(user_id=user.id, session_key=None)
            db.add(cart)
            db.flush()
        return cart

    cart = _guest_cart(db, request)
    if cart is None:
        cart = Cart()
        db.add(cart)
        db.flush()
        _set_cart_cookie(response, cart.session_key)
    return cart


def _guest_cart(db: Session, request: Request) -> Cart | None:
    key = request.cookies.get(settings.cart_cookie_name)
    if not key:
        return None
    return db.scalar(select(Cart).where(Cart.session_key == key, Cart.user_id.is_(None)))


def _merge_items(db: Session, *, source: Cart, target: Cart) -> None:
    for source_item in list(source.items):
        existing = db.scalar(
            select(CartItem).where(
                CartItem.cart_id == target.id, CartItem.variant_id == source_item.variant_id
            )
        )
        if existing:
            existing.quantity = min(existing.quantity + source_item.quantity, 99)
            # Leave the source collection so delete-orphan drops the duplicate row
            # instead of a later cascade deleting it from the target cart.
            source.items.remove(source_item)
            db.delete(source_item)
        else:
            # Appending via the relationship keeps both collections in sync; a raw
            # cart_id reassignment would leave the item in source.items and the
            # delete-orphan cascade on the guest cart would destroy it.
            target.items.append(source_item)
    db.flush()


def attach_user_cart(db: Session, request: Request, response: Response, user: User) -> Cart:
    """Called after login/refresh so a guest cart is folded into the account."""
    return resolve_cart(db, request, response, user)


def _inventory_map(db: Session, variant_ids: list[int]) -> dict[int, Inventory]:
    if not variant_ids:
        return {}
    rows = db.execute(select(Inventory).where(Inventory.variant_id.in_(variant_ids))).scalars()
    return {row.variant_id: row for row in rows}


def serialize_cart(db: Session, cart: Cart) -> CartOut:
    """Cart contents plus totals from the shared pricing engine.

    ``price_for_cart`` also re-validates the applied coupon, so a code that has
    stopped qualifying (items removed, window closed, usage exhausted) is cleared
    here rather than showing a discount the checkout would refuse.
    """
    inventory = {i.variant_id: i for i in (item.variant.inventory for item in cart.items) if i}
    items: list[CartItemOut] = []
    count = 0
    for item in cart.items:
        variant = item.variant
        product = variant.product
        available = inventory[item.variant_id].available if item.variant_id in inventory else 0
        count += item.quantity
        items.append(
            CartItemOut(
                id=item.id,
                variant_id=variant.id,
                product_id=product.id,
                product_name=product.name,
                product_slug=product.slug,
                variant_name=variant.name,
                sku=variant.sku,
                image_url=product.images[0].url if product.images else None,
                unit_price=price(variant.price),
                quantity=item.quantity,
                line_total=float(money(item.unit_price) * item.quantity),
                available=available,
                in_stock=available > 0,
            )
        )

    pricing = discounts_service.price_for_cart(db, cart)
    coupon = cart.coupon if pricing.has_coupon else None
    return CartOut(
        id=cart.id,
        items=items,
        subtotal=float(pricing.subtotal),
        auto_discount=float(pricing.auto_discount),
        discount=float(pricing.discount),
        coupon=(
            CouponOut(
                code=coupon.code,
                kind=coupon.kind.value,
                value=float(coupon.value),
                description=coupon.description,
                discount=float(pricing.coupon_value),
            )
            if coupon is not None
            else None
        ),
        delivery_fee=float(pricing.delivery),
        total=float(pricing.total),
        item_count=count,
    )


def get_item_or_404(db: Session, cart: Cart, item_id: int) -> CartItem:
    item = db.scalar(select(CartItem).where(CartItem.id == item_id, CartItem.cart_id == cart.id))
    if item is None:
        raise NotFoundError("Item not found in your cart")
    return item


def add_item(db: Session, cart: Cart, variant_id: int, quantity: int) -> None:
    from app.modules.catalog.models import ProductVariant

    variant = db.get(ProductVariant, variant_id)
    if variant is None or not variant.is_active or not variant.product.is_active:
        raise NotFoundError("This product is no longer available")
    inventory = db.get(Inventory, variant_id)
    available = inventory.available if inventory else 0
    if available <= 0:
        raise ConflictError("This item is out of stock")

    existing = db.scalar(
        select(CartItem).where(CartItem.cart_id == cart.id, CartItem.variant_id == variant_id)
    )
    target = (existing.quantity if existing else 0) + quantity
    if target > available:
        raise ConflictError(
            f"Only {available} left in stock",
            details={"available": available, "requested": target},
        )
    if existing:
        existing.quantity = target
    else:
        db.add(CartItem(cart_id=cart.id, variant_id=variant_id, quantity=quantity))
    db.flush()


def update_item(db: Session, cart: Cart, item_id: int, quantity: int) -> None:
    item = get_item_or_404(db, cart, item_id)
    inventory = db.get(Inventory, item.variant_id)
    available = inventory.available if inventory else 0
    if quantity > available:
        raise ConflictError(
            f"Only {available} left in stock",
            details={"available": available, "requested": quantity},
        )
    item.quantity = quantity
    db.flush()


def remove_item(db: Session, cart: Cart, item_id: int) -> None:
    item = get_item_or_404(db, cart, item_id)
    db.delete(item)
    db.flush()


def ensure_not_empty(cart: Cart) -> None:
    if not cart.items:
        raise AppError("Your cart is empty")
