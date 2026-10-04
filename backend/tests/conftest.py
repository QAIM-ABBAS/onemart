import os

# 127.0.0.1, not "localhost": ::1 is not published by Docker and stalls ~130s
os.environ["DATABASE_URL"] = "postgresql+psycopg://onemart:onemart@127.0.0.1:5433/onemart_test"
os.environ["REDIS_DISABLED"] = "true"
os.environ["SEED_ON_STARTUP"] = "false"
os.environ["COOKIE_SECURE"] = "false"

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.db import Base, get_db
from app.main import app

ADMIN_EMAIL = "admin@test.dev"
CUSTOMER_EMAIL = "customer@test.dev"
PASSWORD = "Password1!"


def _connect(url: str):
    return create_engine(url, pool_pre_ping=True)


@pytest.fixture(scope="session")
def engine():
    admin_url = os.environ["DATABASE_URL"].rsplit("/", 1)[0] + "/postgres"
    test_url = os.environ["DATABASE_URL"]

    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = 'onemart_test'")
        ).scalar()
        if not exists:
            conn.execute(text("CREATE DATABASE onemart_test"))
    admin_engine.dispose()

    eng = _connect(test_url)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture(autouse=True)
def clean_db(engine):
    # Catalog detail is cached in-process when Redis is disabled; without this,
    # a product read in one test would leak into the next (ratings especially).
    from app.modules.catalog.service import invalidate_catalog_cache

    invalidate_catalog_cache()
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    yield
    invalidate_catalog_cache()


@pytest.fixture()
def session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@pytest.fixture()
def db(session_factory):
    session = session_factory()
    yield session
    session.rollback()
    session.close()


@pytest.fixture()
def client(session_factory):
    from starlette.testclient import TestClient


    def override_get_db():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, base_url="http://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def seed_catalog(db):
    """One category, one product with two variants (stock 1 and 10)."""
    from app.modules.catalog.models import Category, Product, ProductVariant
    from app.modules.inventory.models import Inventory

    category = Category(name="Pantry", slug="pantry")
    db.add(category)
    db.flush()

    product = Product(
        name="Test Oats",
        slug="test-oats",
        category_id=category.id,
        description="Whole grain oats",
        is_active=True,
        is_featured=True,
    )
    db.add(product)
    db.flush()

    small = ProductVariant(
        product_id=product.id, sku="OAT-500", name="500 g", price=100, is_default=True
    )
    large = ProductVariant(product_id=product.id, sku="OAT-1000", name="1 kg", price=180)
    db.add_all([small, large])
    db.flush()
    db.add_all(
        [
            Inventory(variant_id=small.id, quantity=1),
            Inventory(variant_id=large.id, quantity=10),
        ]
    )
    db.commit()
    return {"category": category, "product": product, "small": small, "large": large}


@pytest.fixture()
def customer(client, db):
    from app.core.security import hash_password
    from app.modules.users.models import User, UserRole

    existing = db.query(User).filter(User.email == CUSTOMER_EMAIL).first()
    if existing is None:
        user = User(
            email=CUSTOMER_EMAIL,
            full_name="Casey Customer",
            password_hash=hash_password(PASSWORD),
            role=UserRole.CUSTOMER,
        )
        db.add(user)
        db.commit()
    return CUSTOMER_EMAIL


@pytest.fixture()
def admin_user(db):
    from app.core.security import hash_password
    from app.modules.users.models import User, UserRole

    existing = db.query(User).filter(User.email == ADMIN_EMAIL).first()
    if existing is None:
        user = User(
            email=ADMIN_EMAIL,
            full_name="Ada Admin",
            password_hash=hash_password(PASSWORD),
            role=UserRole.ADMIN,
        )
        db.add(user)
        db.commit()
    return ADMIN_EMAIL


def login(client, email: str, password: str = PASSWORD) -> dict:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
