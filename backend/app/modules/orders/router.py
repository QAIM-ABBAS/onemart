from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, get_current_user_optional
from app.modules.cart import service as cart_service
from app.modules.cart.models import Cart
from app.modules.cart.schemas import AddItemIn, CartOut, UpdateItemIn
from app.modules.catalog.service import invalidate_catalog_cache
from app.modules.discounts import service as discounts_service
from app.modules.discounts.schemas import CouponApplyIn
from app.modules.orders import service as orders_service
from app.modules.orders.payment import payment_registry
from app.modules.orders.schemas import CheckoutIn, OrderDetail, PaymentMethodInfo
from app.modules.users.models import User

router = APIRouter(tags=["cart"])


def _cart_response(db: Session, cart: Cart) -> CartOut:
    """Read a cart back after a write, and persist anything the read changed.

    Order matters twice over: serialising must happen *after* the commit (it
    walks ``cart.items``, which is only trustworthy once the transaction is in
    the database), and the serialiser may itself clear a coupon that no longer
    qualifies — committing that here means the next request sees exactly what
    this response showed.
    """
    db.refresh(cart)
    out = cart_service.serialize_cart(db, cart)
    if db.dirty or db.new or db.deleted:
        db.commit()
    return out


@router.get("/cart", response_model=CartOut)
def get_cart(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    cart = cart_service.resolve_cart(db, request, response, user)
    # Also persists a cart row resolve_cart just created, or the guest→user merge.
    db.commit()
    return _cart_response(db, cart)


@router.post("/cart/items", response_model=CartOut, status_code=201)
def add_to_cart(
    payload: AddItemIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    cart = cart_service.resolve_cart(db, request, response, user)
    cart_service.add_item(db, cart, payload.variant_id, payload.quantity)
    db.commit()
    return _cart_response(db, cart)


@router.patch("/cart/items/{item_id}", response_model=CartOut)
def update_cart_item(
    item_id: int,
    payload: UpdateItemIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    cart = cart_service.resolve_cart(db, request, response, user)
    cart_service.update_item(db, cart, item_id, payload.quantity)
    db.commit()
    return _cart_response(db, cart)


@router.delete("/cart/items/{item_id}", response_model=CartOut)
def remove_cart_item(
    item_id: int,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    cart = cart_service.resolve_cart(db, request, response, user)
    cart_service.remove_item(db, cart, item_id)
    db.commit()
    return _cart_response(db, cart)


@router.post("/cart/coupon", response_model=CartOut)
def apply_coupon(
    payload: CouponApplyIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    """Validate a code against the current cart and pin it to the cart.

    Validation runs again inside checkout, so this is a convenience — never a
    promise: the customer still gets a reason here instead of at place-order.
    """
    cart = cart_service.resolve_cart(db, request, response, user)
    discounts_service.apply_coupon(db, cart, payload.code)
    db.commit()
    return _cart_response(db, cart)


@router.delete("/cart/coupon", response_model=CartOut)
def remove_coupon(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    cart = cart_service.resolve_cart(db, request, response, user)
    discounts_service.clear_coupon(db, cart)
    db.commit()
    return _cart_response(db, cart)


@router.delete("/cart", status_code=204)
def clear_cart(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    cart = cart_service.resolve_cart(db, request, response, user)
    for item in list(cart.items):
        db.delete(item)
    cart.coupon_id = None  # same as checkout: an emptied cart keeps no code
    db.commit()
    return Response(status_code=204)


@router.get("/checkout/summary")
def checkout_summary(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    cart = cart_service.resolve_cart(db, request, response, user)
    db.commit()
    summary = _cart_response(db, cart)
    return {
        "items": summary.items,
        "subtotal": summary.subtotal,
        "auto_discount": summary.auto_discount,
        "discount": summary.discount,
        "coupon": summary.coupon,
        "delivery_fee": summary.delivery_fee,
        "total": summary.total,
        "item_count": summary.item_count,
        "payment_methods": [
            PaymentMethodInfo(code=code, name=payment_registry.get(code).display_name)
            for code in payment_registry.codes
        ],
    }


@router.post("/checkout", response_model=OrderDetail, status_code=201)
def place_order(
    payload: CheckoutIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cart = cart_service.resolve_cart(db, request, response, user)
    cart_service.ensure_not_empty(cart)
    order = orders_service.checkout(db, user, cart, payload)
    invalidate_catalog_cache()
    return orders_service.order_to_detail(order)
