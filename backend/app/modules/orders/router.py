from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, get_current_user_optional
from app.modules.cart import service as cart_service
from app.modules.cart.schemas import AddItemIn, CartOut, UpdateItemIn
from app.modules.catalog.service import invalidate_catalog_cache
from app.modules.orders import service as orders_service
from app.modules.orders.payment import payment_registry
from app.modules.orders.schemas import CheckoutIn, OrderDetail, PaymentMethodInfo
from app.modules.users.models import User

router = APIRouter(tags=["cart"])


@router.get("/cart", response_model=CartOut)
def get_cart(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    cart = cart_service.resolve_cart(db, request, response, user)
    db.flush()
    return cart_service.serialize_cart(cart)


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
    db.refresh(cart)
    return cart_service.serialize_cart(cart)


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
    db.refresh(cart)
    return cart_service.serialize_cart(cart)


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
    db.refresh(cart)
    return cart_service.serialize_cart(cart)


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
    db.flush()
    summary = cart_service.serialize_cart(cart)
    return {
        "items": summary.items,
        "subtotal": summary.subtotal,
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
