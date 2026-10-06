
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import AppError, ConflictError, NotFoundError
from app.core.pagination import Page, PaginationParams
from app.modules.audit import service as audit_service
from app.modules.cart.models import Cart, CartItem
from app.modules.discounts import service as discounts_service
from app.modules.discounts.pricing import price_cart
from app.modules.inventory.models import Inventory
from app.modules.inventory.service import ensure_inventory
from app.modules.notifications import service as notifications_service
from app.modules.notifications.models import NotificationType
from app.modules.orders.models import (
    ALLOWED_TRANSITIONS,
    CANCELLABLE_STATUSES,
    CUSTOMER_CANCELLABLE_STATUSES,
    Order,
    OrderItem,
    OrderStatus,
    OrderStatusHistory,
    PaymentStatus,
)
from app.modules.orders.payment import payment_registry
from app.modules.orders.schemas import CheckoutIn, OrderDetail, OrderListItem, StatusUpdateIn
from app.modules.users.models import Address, User, UserRole

# What the customer is told when an order reaches each status: notification type,
# the verb for the title, and the default body (an admin's note overrides it).
_STATUS_NOTIFICATIONS: dict[OrderStatus, tuple[NotificationType, str, str]] = {
    OrderStatus.CONFIRMED: (
        NotificationType.ORDER_STATUS,
        "confirmed",
        "The store has confirmed your order.",
    ),
    OrderStatus.PACKED: (
        NotificationType.ORDER_STATUS,
        "is packed",
        "Your items are packed and ready to go.",
    ),
    OrderStatus.SHIPPED: (
        NotificationType.ORDER_STATUS,
        "has shipped",
        "Your order is on its way to you.",
    ),
    OrderStatus.DELIVERED: (
        NotificationType.ORDER_STATUS,
        "was delivered",
        "Your order was delivered. Thank you for shopping with OneMart!",
    ),
    OrderStatus.CANCELLED: (
        NotificationType.ORDER_CANCELLED,
        "was cancelled",
        "Your order was cancelled.",
    ),
}


def checkout(db: Session, user: User, cart: Cart, payload: CheckoutIn) -> Order:
    """Create an order from the user's cart.

    Inventory rows are locked with SELECT ... FOR UPDATE and the order is written in
    the very same transaction: stock is never checked in a separate step from the
    order insert. The coupon's usage limit is claimed in that same transaction too,
    so a coupon can never be redeemed more times than it allows.
    """
    if not cart.items:
        raise AppError("Your cart is empty")

    provider = payment_registry.get(payload.payment_method)
    address = _resolve_address(db, user, payload)

    variant_ids = sorted({item.variant_id for item in cart.items})
    # Lock the stock rows for this transaction. populate_existing is required: the
    # session may already hold these rows in its identity map (cart -> variant ->
    # inventory), and without it the locked result would be ignored in favour of the
    # stale in-memory copy — which would defeat the lock.
    locked_rows = db.execute(
        select(Inventory)
        .where(Inventory.variant_id.in_(variant_ids))
        .order_by(Inventory.variant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalars()
    inventory = {row.variant_id: row for row in locked_rows}

    shortages = []
    for item in cart.items:
        row = inventory.get(item.variant_id)
        available = row.available if row else 0
        if item.quantity > available:
            shortages.append(
                {
                    "variant_id": item.variant_id,
                    "product": item.variant.product.name,
                    "variant": item.variant.name,
                    "requested": item.quantity,
                    "available": available,
                }
            )
    if shortages:
        raise ConflictError(
            "Some items in your cart just ran out of stock",
            details={"shortages": shortages},
        )

    # Re-validate the applied coupon against the cart as it stands right now and
    # price it with the shared engine: the order total must be exactly the total
    # the customer saw in the cart (and in /checkout/summary).
    coupon = discounts_service.active_coupon(db, cart, strict=True)
    pricing = price_cart(
        discounts_service.cart_lines(cart),
        discounts_service.spec_for(coupon) if coupon is not None else None,
    )

    order = Order(
        order_number="PENDING",
        user_id=user.id,
        payment_method=provider.code,
        payment_status=PaymentStatus.PENDING,
        recipient_name=address["full_name"],
        phone=address["phone"],
        line1=address["line1"],
        line2=address.get("line2"),
        city=address["city"],
        state=address["state"],
        postal_code=address["postal_code"],
        country=address["country"],
        subtotal=pricing.subtotal,
        discount_total=pricing.discount,
        delivery_fee=pricing.delivery,
        total=pricing.total,
        coupon_id=pricing.coupon_id,
        coupon_code=pricing.coupon_code,
        customer_note=payload.note,
    )
    db.add(order)
    db.flush()
    from datetime import UTC, datetime

    order.order_number = f"OM-{datetime.now(UTC):%Y%m%d}-{order.id:06d}"

    if pricing.has_coupon and coupon is not None:
        # Atomic conditional UPDATE: of two customers racing for the last
        # redemption exactly one wins; the loser gets 409 and nothing is written.
        discounts_service.claim_usage(db, coupon)

    for item in cart.items:
        variant = item.variant
        product = variant.product
        db.add(
            OrderItem(
                order_id=order.id,
                variant_id=variant.id,
                product_id=product.id,
                product_name=product.name,
                variant_name=variant.name,
                sku=variant.sku,
                product_slug=product.slug,
                image_url=product.images[0].url if product.images else None,
                unit_price=variant.price,
                quantity=item.quantity,
                line_total=variant.price * item.quantity,
            )
        )
        row = inventory[variant.id]
        row.quantity -= item.quantity

    if pricing.has_coupon and coupon is not None:
        discounts_service.record_redemption(
            db, coupon, user_id=user.id, order_id=order.id, discount=pricing.discount
        )

    result = provider.authorize(order, pricing.total)
    order.payment_status = result.status

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            status=OrderStatus.PENDING,
            note="Order placed",
            actor_id=user.id,
        )
    )
    db.execute(delete(CartItem).where(CartItem.cart_id == cart.id))
    # The cart is empty now: don't leave the redeemed code pinned to it.
    cart.coupon_id = None
    notifications_service.notify(
        db,
        user_id=user.id,
        type=NotificationType.ORDER_PLACED,
        title=f"Order {order.order_number} placed",
        body="We have received your order. Payment is due on delivery.",
        link=f"/orders/{order.id}",
    )
    db.commit()
    return order


def _resolve_address(db: Session, user: User, payload: CheckoutIn) -> dict:
    if payload.address_id is not None:
        saved = db.scalar(
            select(Address).where(Address.id == payload.address_id, Address.user_id == user.id)
        )
        if saved is None:
            raise NotFoundError("Address not found")
        return {
            "full_name": saved.full_name,
            "phone": saved.phone,
            "line1": saved.line1,
            "line2": saved.line2,
            "city": saved.city,
            "state": saved.state,
            "postal_code": saved.postal_code,
            "country": saved.country,
        }

    data = payload.address.model_dump()
    if payload.save_address:
        db.add(Address(user_id=user.id, **data))
    return data


def _order_options():
    return (
        selectinload(Order.items),
        selectinload(Order.history),
    )


def list_customer_orders(db: Session, user: User, params: PaginationParams) -> Page[OrderListItem]:
    filters = [Order.user_id == user.id]
    total = db.execute(select(func.count()).select_from(Order).where(*filters)).scalar_one()

    sort_map = {
        "newest": Order.created_at.desc(),
        "oldest": Order.created_at.asc(),
        "total_desc": Order.total.desc(),
        "total_asc": Order.total.asc(),
    }
    order_by = sort_map.get(params.sort, sort_map["newest"])

    rows = db.scalars(
        select(Order)
        .where(*filters)
        .order_by(order_by, Order.id.desc())
        .offset(params.offset)
        .limit(params.page_size)
    ).unique().all()

    items = [
        OrderListItem(
            id=o.id,
            order_number=o.order_number,
            status=o.status,
            payment_method=o.payment_method,
            payment_status=o.payment_status,
            total=float(o.total),
            item_count=sum(i.quantity for i in o.items),
            created_at=o.created_at,
        )
        for o in rows
    ]
    pages = max((total + params.page_size - 1) // params.page_size, 1) if total else 1
    return Page[OrderListItem](
        items=items, total=total, page=params.page, page_size=params.page_size, pages=pages
    )


def get_customer_order(db: Session, user: User, order_id: int) -> Order:
    order = db.scalar(
        select(Order)
        .where(Order.id == order_id, Order.user_id == user.id)
        .options(*_order_options())
    )
    if order is None:
        raise NotFoundError("Order not found")
    return order


def list_admin_orders(db: Session, params: PaginationParams, status: str | None, q: str | None) -> Page[OrderListItem]:
    filters = []
    if status:
        try:
            filters.append(Order.status == OrderStatus(status))
        except ValueError as exc:
            raise AppError(f"Unknown status '{status}'") from exc
    if q:
        needle = f"%{q.strip()}%"
        filters.append(
            Order.order_number.ilike(needle)
            | Order.recipient_name.ilike(needle)
            | Order.user.has(User.email.ilike(needle))
        )

    total = db.execute(select(func.count()).select_from(Order).where(*filters)).scalar_one()

    sort_map = {
        "newest": Order.created_at.desc(),
        "oldest": Order.created_at.asc(),
        "total_desc": Order.total.desc(),
        "total_asc": Order.total.asc(),
    }
    order_by = sort_map.get(params.sort, sort_map["newest"])

    rows = db.scalars(
        select(Order)
        .where(*filters)
        .options(*_order_options())
        .order_by(order_by, Order.id.desc())
        .offset(params.offset)
        .limit(params.page_size)
    ).unique().all()

    items = [
        OrderListItem(
            id=o.id,
            order_number=o.order_number,
            status=o.status,
            payment_method=o.payment_method,
            payment_status=o.payment_status,
            total=float(o.total),
            item_count=sum(i.quantity for i in o.items),
            created_at=o.created_at,
        )
        for o in rows
    ]
    pages = max((total + params.page_size - 1) // params.page_size, 1) if total else 1
    return Page[OrderListItem](
        items=items, total=total, page=params.page, page_size=params.page_size, pages=pages
    )


def get_admin_order(db: Session, order_id: int) -> Order:
    order = db.scalar(select(Order).where(Order.id == order_id).options(*_order_options()))
    if order is None:
        raise NotFoundError("Order not found")
    return order


def update_order_status(db: Session, order: Order, payload: StatusUpdateIn, actor: User) -> Order:
    """Advance an order along its status timeline (append-only history)."""
    if payload.status == order.status:
        raise ConflictError(f"Order is already '{order.status.value}'")

    allowed = ALLOWED_TRANSITIONS.get(order.status, set())
    if payload.status not in allowed:
        raise ConflictError(
            f"Cannot move order from '{order.status.value}' to '{payload.status.value}'",
            details={"allowed": sorted(s.value for s in allowed)},
        )

    from_status = order.status
    provider = payment_registry.get(order.payment_method)

    if payload.status == OrderStatus.CANCELLED and order.status in CANCELLABLE_STATUSES:
        _restock_order(db, order)

    order.status = payload.status

    if payload.status == OrderStatus.DELIVERED and order.payment_status == PaymentStatus.PENDING:
        result = provider.capture(order, order.total)
        order.payment_status = result.status
    elif payload.status == OrderStatus.CANCELLED and order.payment_status == PaymentStatus.PAID:
        result = provider.refund(order, order.total)
        order.payment_status = result.status

    # `order=order` (not order_id): the parent's collection may already be
    # loaded, and back_populates keeps it in sync so the response this mutation
    # returns shows the row it just wrote.
    db.add(
        OrderStatusHistory(
            order=order,
            status=payload.status,
            note=payload.note,
            actor_id=actor.id,
        )
    )
    # Staff moves leave an accountability trail in the audit log; a customer's
    # own cancellation is already recorded by the history row above (same
    # precedent as reviews: admin actions audited, self-service not).
    if actor.role != UserRole.CUSTOMER:
        audit_service.record(
            db,
            actor_id=actor.id,
            action="order.status_change",
            entity="order",
            entity_id=order.id,
            detail={
                "from": from_status.value,
                "to": payload.status.value,
                "note": payload.note,
            },
        )
    # The customer hears about it — whoever moved the order (their own
    # cancellation included). An admin's note becomes the message body.
    status_notification = _STATUS_NOTIFICATIONS.get(payload.status)
    if status_notification is not None:
        kind, verb, default_body = status_notification
        notifications_service.notify(
            db,
            user_id=order.user_id,
            type=kind,
            title=f"Order {order.order_number} {verb}",
            body=payload.note or default_body,
            link=f"/orders/{order.id}",
        )
    db.commit()
    return order


def cancel_customer_order(db: Session, order: Order, user: User) -> Order:
    """Customer self-service cancellation, Pending/Confirmed only.

    Everything else (stock restore, history row, payment side effects,
    transition validation) is `update_order_status`, so there is exactly one
    cancellation path to keep correct.
    """
    if order.status == OrderStatus.CANCELLED:
        raise ConflictError("This order has already been cancelled")
    if order.status not in CUSTOMER_CANCELLABLE_STATUSES:
        raise ConflictError(
            "This order can no longer be cancelled — it is already being prepared.",
            details={"allowed": sorted(s.value for s in CUSTOMER_CANCELLABLE_STATUSES)},
        )
    return update_order_status(
        db,
        order,
        StatusUpdateIn(status=OrderStatus.CANCELLED, note="Cancelled by the customer"),
        user,
    )


def _restock_order(db: Session, order: Order) -> None:
    variant_ids = sorted(i.variant_id for i in order.items if i.variant_id is not None)
    if not variant_ids:
        return
    rows = db.execute(
        select(Inventory)
        .where(Inventory.variant_id.in_(variant_ids))
        .order_by(Inventory.variant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalars()
    by_variant = {row.variant_id: row for row in rows}
    for item in order.items:
        if item.variant_id is None:
            continue
        row = by_variant.get(item.variant_id)
        if row is None:
            row = ensure_inventory(db, item.variant_id, 0)
        row.quantity += item.quantity


def order_to_detail(order: Order) -> OrderDetail:
    return OrderDetail.model_validate(order)
