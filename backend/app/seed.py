"""Development seed data: catalog, demo accounts and a few sample orders."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.modules.catalog.models import Brand, Category, Product, ProductImage, ProductVariant
from app.modules.inventory.models import Inventory
from app.modules.orders.models import (
    Order,
    OrderItem,
    OrderStatus,
    OrderStatusHistory,
    PaymentStatus,
)
from app.modules.users.models import Address, User, UserRole

TINTS = [
    ("E7EEE9", "1F3D2B"),
    ("F1E7D8", "5A4326"),
    ("E9EEF3", "1F3450"),
    ("F3E4E0", "5A2622"),
    ("EDE8F2", "38265A"),
    ("EAF0E5", "2E4A1F"),
]


def image_url(text: str, index: int = 0, size: int = 800) -> str:
    bg, fg = TINTS[index % len(TINTS)]
    return f"/api/img/placeholder.svg?text={quote(text)}&bg={bg}&fg={fg}"


CATEGORY_TREE = [
    ("Fresh Produce", "fresh-produce", [("Fruits", "fruits"), ("Vegetables", "vegetables")]),
    (
        "Dairy & Bakery",
        "dairy-bakery",
        [("Milk & Eggs", "milk-eggs"), ("Bread & Bakery", "bread-bakery")],
    ),
    (
        "Beverages",
        "beverages",
        [("Juices", "juices"), ("Tea & Coffee", "tea-coffee"), ("Soft Drinks", "soft-drinks")],
    ),
    (
        "Snacks & Sweets",
        "snacks-sweets",
        [
            ("Chips & Namkeen", "chips"),
            ("Biscuits & Cookies", "biscuits"),
            ("Chocolates", "chocolates"),
        ],
    ),
    (
        "Household",
        "household",
        [("Cleaning Supplies", "cleaning"), ("Laundry Care", "laundry")],
    ),
    (
        "Personal Care",
        "personal-care",
        [("Hair Care", "hair-care"), ("Skin & Bath", "skin-bath"), ("Oral Care", "oral-care")],
    ),
    ("Baby Care", "baby-care", [("Diapers & Wipes", "diapers")]),
]

BRANDS = [
    "Amul", "Britannia", "Nestlé", "Tata", "Real", "Lipton", "Colgate", "Surf Excel",
    "Lay's", "Cadbury", "Haldiram's", "Harpic", "Dettol", "Head & Shoulders", "Pampers",
    "Coca-Cola", "Nescafé", "Vim",
]

# (name, category-slug, brand, description, featured, [(variant_name, sku-suffix, price, stock, attrs)])
PRODUCTS = [
    (
        "Robusta Bananas", "fruits", None,
        "Fresh, naturally ripened Robusta bananas. Sweet and creamy — perfect for breakfast or a quick snack.",
        True,
        [("500 g bunch", "BAN-500", 35, 60, {"weight": "500 g"}),
         ("1 kg bunch", "BAN-1000", 65, 45, {"weight": "1 kg"})],
    ),
    (
        "Shimla Apples", "fruits", None,
        "Crisp Himalayan Shimla apples, hand picked for sweetness. Comes in a protective tray pack.",
        False,
        [("4 pcs (~500 g)", "APL-4PC", 120, 30, {"pack": "4 pcs"}),
         ("1 kg", "APL-1000", 220, 24, {"weight": "1 kg"})],
    ),
    (
        "Farm Tomatoes", "vegetables", None,
        "Vine-ripened country tomatoes. Firm, juicy and ideal for curries, salads and chutneys.",
        True,
        [("500 g", "TOM-500", 28, 70, {"weight": "500 g"}),
         ("1 kg", "TOM-1000", 52, 55, {"weight": "1 kg"})],
    ),
    (
        "Onion Combo Pack", "vegetables", None,
        "Medium sized Nashik red onions, cleaned and sorted. Staple for every Indian kitchen.",
        False,
        [("1 kg", "ONI-1000", 45, 80, {"weight": "1 kg"}),
         ("5 kg value pack", "ONI-5000", 205, 20, {"weight": "5 kg"})],
    ),
    (
        "Amul Toned Milk", "milk-eggs", "Amul",
        "Hygienically packed toned milk from Amul. Rich in protein and calcium for the whole family.",
        True,
        [("500 ml pouch", "AMUL-MILK-500", 27, 120, {"volume": "500 ml"}),
         ("1 L pouch", "AMUL-MILK-1000", 53, 90, {"volume": "1 L"})],
    ),
    (
        "Amul Butter", "milk-eggs", "Amul",
        "The iconicutter. Made from fresh cream, perfect on toast or for cooking.",
        False,
        [("100 g", "AMUL-BTR-100", 58, 64, {"weight": "100 g"}),
         ("500 g", "AMUL-BTR-500", 265, 32, {"weight": "500 g"})],
    ),
    (
        "Amul Cheese Slices", "milk-eggs", "Amul",
        "Processed cheese slices individually wrapped — great for sandwiches and burgers.",
        False,
        [("100 g (5 slices)", "AMUL-CHZ-5", 85, 40, {"pack": "5 slices"}),
         ("400 g (20 slices)", "AMUL-CHZ-20", 320, 18, {"pack": "20 slices"})],
    ),
    (
        "Britannia Brown Bread", "bread-bakery", "Britannia",
        "Soft whole-wheat brown bread baked fresh daily. High in fibre, low in fat.",
        False,
        [("400 g", "BRN-BRD-400", 45, 36, {"weight": "400 g"})],
    ),
    (
        "Everyday Eggs", "milk-eggs", None,
        "Farm fresh white eggs, Grade A. Carefully packed to avoid breakage.",
        False,
        [("Pack of 6", "EGG-6", 66, 44, {"pack": "6 eggs"}),
         ("Pack of 12", "EGG-12", 128, 26, {"pack": "12 eggs"})],
    ),
    (
        "Real Mixed Fruit Juice", "juices", "Real",
        "No added preservatives mixed fruit juice — a blend of apple, grape, orange and pineapple.",
        True,
        [("200 ml", "REAL-J-200", 25, 110, {"volume": "200 ml"}),
         ("1 L", "REAL-J-1000", 115, 52, {"volume": "1 L"})],
    ),
    (
        "Tata Tea Gold", "tea-coffee", "Tata",
        "A rich blend of long leaves and gentle assam dust for a strong, flavourful cup.",
        True,
        [("250 g", "TATA-TEA-250", 165, 48, {"weight": "250 g"}),
         ("500 g", "TATA-TEA-500", 320, 26, {"weight": "500 g"})],
    ),
    (
        "Nescafé Classic Coffee", "tea-coffee", "Nescafé",
        "Instant coffee made from carefully roasted coffee beans for a smooth, rich taste.",
        False,
        [("50 g jar", "NES-50", 230, 34, {"weight": "50 g"}),
         ("100 g jar", "NES-100", 440, 16, {"weight": "100 g"})],
    ),
    (
        "Coca-Cola Soft Drink", "soft-drinks", "Coca-Cola",
        "Refreshing Coca-Cola bottle. Serve chilled for the best taste.",
        False,
        [("750 ml", "COKE-750", 40, 96, {"volume": "750 ml"}),
         ("2.25 L", "COKE-2250", 95, 40, {"volume": "2.25 L"})],
    ),
    (
        "Lay's Classic Salted Chips", "chips", "Lay's",
        "Golden potato chips with a light sprinkling of salt. The classic everyone loves.",
        True,
        [("52 g", "LEYS-52", 20, 140, {"weight": "52 g"}),
         ("110 g party pack", "LEYS-110", 45, 72, {"weight": "110 g"})],
    ),
    (
        "Haldiram's Aloo Bhujia", "chips", "Haldiram's",
        "Crispy spiced potato bhujia made with gram flour. A perfect evening tea-time snack.",
        False,
        [("200 g", "HAL-AB-200", 55, 58, {"weight": "200 g"}),
         ("400 g", "HAL-AB-400", 105, 30, {"weight": "400 g"})],
    ),
    (
        "Britannia Marie Gold", "biscuits", "Britannia",
        "Light, crispy tea biscuits made with wheat. Dunk them in tea or enjoy plain.",
        False,
        [("250 g", "BRN-MG-250", 35, 88, {"weight": "250 g"}),
         ("500 g", "BRN-MG-500", 66, 42, {"weight": "500 g"})],
    ),
    (
        "Cadbury Dairy Milk", "chocolates", "Cadbury",
        "Smooth and creamy milk chocolate — a timeless favourite for every occasion.",
        True,
        [("55 g", "CDM-55", 50, 100, {"weight": "55 g"}),
         ("150 g bar", "CDM-150", 135, 46, {"weight": "150 g"})],
    ),
    (
        "Surf Excel Easy Wash", "laundry", "Surf Excel",
        "Detergent powder that tackles tough stains while staying gentle on clothes.",
        False,
        [("1 kg", "SURF-1000", 135, 50, {"weight": "1 kg"}),
         ("4 kg value pack", "SURF-4000", 495, 18, {"weight": "4 kg"})],
    ),
    (
        "Harpic Toilet Cleaner", "cleaning", "Harpic",
        "Thick formula that removes 99.9% of germs and stains from the toilet bowl.",
        False,
        [("500 ml", "HARP-500", 99, 44, {"volume": "500 ml"}),
         ("1 L", "HARP-1000", 178, 22, {"volume": "1 L"})],
    ),
    (
        "Vim Dishwash Bar", "cleaning", "Vim",
        "Cuts through grease on utensils in seconds. Long-lasting and easy on hands.",
        False,
        [("Single bar", "VIM-1PC", 20, 130, {"pack": "1 bar"}),
         ("Pack of 3", "VIM-3PC", 55, 60, {"pack": "3 bars"})],
    ),
    (
        "Colgate Strong Teeth", "oral-care", "Colgate",
        "Toothpaste with calcium-boost formula for stronger teeth and healthy gums.",
        False,
        [("100 g", "CLG-100", 58, 74, {"weight": "100 g"}),
         ("200 g", "CLG-200", 105, 38, {"weight": "200 g"})],
    ),
    (
        "Dettol Handwash", "skin-bath", "Dettol",
        "Original germ-protection liquid handwash. Gentle on skin, tough on germs.",
        False,
        [("200 ml refill", "DET-200", 49, 86, {"volume": "200 ml"}),
         ("500 ml pump", "DET-500", 99, 40, {"volume": "500 ml"})],
    ),
    (
        "Head & Shoulders Shampoo", "hair-care", "Head & Shoulders",
        "Anti-dandruff shampoo that leaves hair visibly healthier from first wash.",
        False,
        [("180 ml", "HS-180", 210, 36, {"volume": "180 ml"}),
         ("340 ml", "HS-340", 360, 20, {"volume": "340 ml"})],
    ),
    (
        "Pampers Diapers", "diapers", "Pampers",
        "All-round protection diapers with up to 12 hours of dryness. Soft and breathable.",
        False,
        [("Medium — pack of 34", "PAM-M34", 749, 22, {"size": "M", "pack": "34 pcs"}),
         ("Large — pack of 62", "PAM-L62", 1299, 12, {"size": "L", "pack": "62 pcs"})],
    ),
    (
        "Baby Wipes", "diapers", None,
        "Gentle, alcohol-free wipes for soft baby skin. Resealable pack keeps them moist.",
        False,
        [("Pack of 72", "WIP-72", 149, 48, {"pack": "72 wipes"})],
    ),
    (
        "Assam Green Tea", "tea-coffee", "Lipton",
        "Light and refreshing green tea bags with a delicate, naturally soothing flavour.",
        False,
        [("25 bags", "LIPTON-GT-25", 95, 54, {"pack": "25 bags"}),
         ("100 bags", "LIPTON-GT-100", 345, 20, {"pack": "100 bags"})],
    ),
]


def _slug(name: str) -> str:
    cleaned = name.replace("&", " ").replace("'", "").replace("’", "").lower()
    out = "".join(c if c.isalnum() else "-" for c in cleaned)
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-")


def seed(db: Session) -> None:
    if db.scalar(select(Product.id).limit(1)) is not None:
        return

    categories: dict[str, Category] = {}
    for position, (parent_name, parent_slug, children) in enumerate(CATEGORY_TREE):
        parent = Category(name=parent_name, slug=_slug(parent_slug), position=position)
        db.add(parent)
        db.flush()
        categories[_slug(parent_slug)] = parent
        for index, (child_name, child_slug) in enumerate(children):
            node = Category(name=child_name, slug=child_slug, parent_id=parent.id, position=index)
            db.add(node)
            db.flush()
            categories[child_slug] = node

    brands: dict[str, Brand] = {}
    for name in BRANDS:
        brand = Brand(name=name, slug=_slug(name))
        db.add(brand)
        db.flush()
        brands[name] = brand

    users = _seed_users(db)
    variants_by_sku: dict[str, ProductVariant] = {}

    for product_index, (name, cat_slug, brand_name, description, featured, variants) in enumerate(
        PRODUCTS
    ):
        category = categories.get(cat_slug)
        assert category is not None, f"unknown category {cat_slug}"
        product = Product(
            name=name,
            slug=_slug(name),
            category_id=category.id,
            brand_id=brands[brand_name].id if brand_name else None,
            description=description,
            is_featured=featured,
            published_at=datetime.now(UTC) - timedelta(days=len(PRODUCTS) - product_index),
        )
        db.add(product)
        db.flush()

        for index, (v_name, sku_suffix, price, stock, attrs) in enumerate(variants):
            variant = ProductVariant(
                product_id=product.id,
                sku=f"OM-{sku_suffix}",
                name=v_name,
                attributes=attrs,
                price=Decimal(str(price)),
                compare_at_price=Decimal(str(int(price * 1.15))) if index > 0 else None,
                is_default=index == 0,
                position=index,
            )
            db.add(variant)
            db.flush()
            db.add(Inventory(variant_id=variant.id, quantity=stock, low_stock_threshold=8))
            variants_by_sku[variant.sku] = variant

        for image_index in range(3 if product_index % 3 == 0 else 2):
            db.add(
                ProductImage(
                    product_id=product.id,
                    url=image_url(name, image_index),
                    alt=f"{name} — view {image_index + 1}",
                    position=image_index,
                )
            )

    _seed_orders(db, users["customer"], variants_by_sku)
    db.commit()


def _seed_users(db: Session) -> dict[str, User]:
    people = [
        ("admin@onemart.test", "Admin OneMart", "Admin@1234", UserRole.ADMIN),
        ("staff@onemart.test", "Store Staff", "Staff@1234", UserRole.STAFF),
        ("demo@onemart.test", "Demo Customer", "Demo@1234", UserRole.CUSTOMER),
    ]
    users: dict[str, User] = {}
    for email, name, password, role in people:
        user = User(email=email, full_name=name, password_hash=hash_password(password), role=role)
        db.add(user)
        db.flush()
        if role == UserRole.CUSTOMER:
            db.add(
                Address(
                    user_id=user.id,
                    full_name=name,
                    phone="+91 98765 43210",
                    line1="42, Rose Villa, MG Road",
                    line2="Near City Mall",
                    city="Bengaluru",
                    state="Karnataka",
                    postal_code="560001",
                    country="IN",
                    is_default=True,
                )
            )
        users["customer" if role == UserRole.CUSTOMER else role.value] = user
    db.flush()
    return users


def _seed_orders(db: Session, customer: User, variants: dict[str, ProductVariant]) -> None:
    plans = [
        (0, OrderStatus.DELIVERED, 12, ["OM-AMUL-MILK-1000", "OM-BRN-BRD-400"], [2, 1]),
        (4, OrderStatus.SHIPPED, 6, ["OM-LEYS-110", "OM-CDM-150", "OM-TATA-TEA-250"], [3, 2, 1]),
        (9, OrderStatus.CONFIRMED, 2, ["OM-SURF-1000", "OM-HARP-500"], [1, 1]),
        (16, OrderStatus.PENDING, 0, ["OM-REAL-J-1000", "OM-APL-1000"], [1, 1]),
        (22, OrderStatus.CANCELLED, 0, ["OM-CLG-200"], [2]),
    ]

    for order_index, (days_ago, status, _, skus, quantities) in enumerate(plans):
        placed = datetime.now(UTC) - timedelta(days=days_ago, hours=order_index + 1)
        items: list[tuple[ProductVariant, int]] = []
        for sku, quantity in zip(skus, quantities, strict=True):
            variant = variants.get(sku)
            if variant is None:
                raise RuntimeError(f"seed order references missing sku {sku}")
            items.append((variant, quantity))

        subtotal = sum(variant.price * qty for variant, qty in items)
        delivery = Decimal("0") if subtotal >= 999 else Decimal("40")
        order = Order(
            order_number="PENDING",
            user_id=customer.id,
            status=OrderStatus.PENDING,
            payment_method="cod",
            payment_status=PaymentStatus.PENDING,
            recipient_name=customer.full_name,
            phone="+91 98765 43210",
            line1="42, Rose Villa, MG Road",
            line2="Near City Mall",
            city="Bengaluru",
            state="Karnataka",
            postal_code="560001",
            country="IN",
            subtotal=subtotal,
            delivery_fee=delivery,
            total=subtotal + delivery,
            placed_at=placed,
            created_at=placed,
        )
        db.add(order)
        db.flush()
        order.order_number = f"OM-{placed:%Y%m%d}-{order.id:06d}"

        for variant, quantity in items:
            db.add(
                OrderItem(
                    order_id=order.id,
                    variant_id=variant.id,
                    product_id=variant.product_id,
                    product_name=variant.product.name,
                    variant_name=variant.name,
                    sku=variant.sku,
                    product_slug=variant.product.slug,
                    image_url=variant.product.images[0].url if variant.product.images else None,
                    unit_price=variant.price,
                    quantity=quantity,
                    line_total=variant.price * quantity,
                )
            )
            inventory = db.get(Inventory, variant.id)
            if inventory and status != OrderStatus.CANCELLED:
                inventory.quantity = max(inventory.quantity - quantity, 0)

        timeline = [OrderStatus.PENDING]
        if status != OrderStatus.PENDING:
            timeline = [OrderStatus.PENDING, OrderStatus.CONFIRMED]
        if status in (OrderStatus.SHIPPED, OrderStatus.DELIVERED):
            timeline += [OrderStatus.PACKED, OrderStatus.SHIPPED]
        if status == OrderStatus.DELIVERED:
            timeline += [OrderStatus.DELIVERED]
        if status == OrderStatus.CANCELLED:
            timeline += [OrderStatus.CANCELLED]

        for step, step_status in enumerate(timeline):
            event_at = placed + timedelta(hours=step + 1)
            db.add(
                OrderStatusHistory(
                    order_id=order.id,
                    status=step_status,
                    note="Order placed" if step == 0 else None,
                    actor_id=customer.id,
                    created_at=event_at,
                )
            )
            order.status = step_status
        if status in (OrderStatus.DELIVERED,):
            order.payment_status = PaymentStatus.PAID
        if status == OrderStatus.CANCELLED:
            order.payment_status = PaymentStatus.PENDING
        db.flush()


def seed_if_empty() -> None:
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()


if __name__ == "__main__":
    seed_if_empty()
    print("seed complete")
