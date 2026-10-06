import logging
from contextlib import asynccontextmanager
from html import escape

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.exceptions import AppError

logger = logging.getLogger("onemart")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.seed_on_startup:
        from app.seed import seed_if_empty

        seed_if_empty()
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="OneMart — everything you need, in one place.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_error",
                "message": "Please check the highlighted fields",
                "details": [
                    {"field": ".".join(str(loc) for loc in err["loc"][1:]), "message": err["msg"]}
                    for err in exc.errors()
                ],
            }
        },
    )


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    logger.warning("Integrity error on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=409,
        content={
            "error": {
                "code": "conflict",
                "message": "That change conflicts with existing data",
                "details": None,
            }
        },
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "server_error",
                "message": "Something went wrong on our side. Please try again.",
                "details": None,
            }
        },
    )


from fastapi import Query  # noqa: E402

from app.modules.catalog.admin_router import router as catalog_admin_router  # noqa: E402
from app.modules.catalog.router import router as catalog_router  # noqa: E402
from app.modules.discounts.admin_router import router as discounts_admin_router  # noqa: E402
from app.modules.inventory.router import router as inventory_admin_router  # noqa: E402
from app.modules.notifications.router import router as notifications_router  # noqa: E402
from app.modules.orders.admin_router import router as orders_admin_router  # noqa: E402
from app.modules.orders.customer_router import router as orders_router  # noqa: E402
from app.modules.orders.router import router as cart_checkout_router  # noqa: E402
from app.modules.reports.router import router as reports_router  # noqa: E402
from app.modules.reviews.admin_router import router as reviews_admin_router  # noqa: E402
from app.modules.reviews.router import router as reviews_router  # noqa: E402
from app.modules.users.router import address_router  # noqa: E402
from app.modules.users.router import router as auth_router  # noqa: E402
from app.modules.wishlist.router import router as wishlist_router  # noqa: E402

API_PREFIX = "/api"

app.include_router(auth_router, prefix=f"{API_PREFIX}")
app.include_router(address_router, prefix=f"{API_PREFIX}")
app.include_router(catalog_router, prefix=f"{API_PREFIX}")
app.include_router(cart_checkout_router, prefix=f"{API_PREFIX}")
app.include_router(orders_router, prefix=f"{API_PREFIX}")
app.include_router(catalog_admin_router, prefix=f"{API_PREFIX}")
app.include_router(inventory_admin_router, prefix=f"{API_PREFIX}")
app.include_router(discounts_admin_router, prefix=f"{API_PREFIX}")
app.include_router(reports_router, prefix=f"{API_PREFIX}")
app.include_router(orders_admin_router, prefix=f"{API_PREFIX}")
app.include_router(reviews_router, prefix=f"{API_PREFIX}")
app.include_router(reviews_admin_router, prefix=f"{API_PREFIX}")
app.include_router(wishlist_router, prefix=f"{API_PREFIX}")
app.include_router(notifications_router, prefix=f"{API_PREFIX}")


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.app_name}


@app.get("/api/img/placeholder.svg")
def placeholder_image(
    text: str = Query("OneMart", max_length=40),
    bg: str = Query("E7EEE9", pattern=r"^[0-9A-Fa-f]{6}$"),
    fg: str = Query("1F3D2B", pattern=r"^[0-9A-Fa-f]{6}$"),
):
    words = [w for w in text.split() if w][:2]
    initials = escape("".join(w[0].upper() for w in words) or "OM")
    label = escape(" ".join(words).upper())
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <rect width="800" height="800" fill="#{bg}"/>
  <rect x="40" y="40" width="720" height="720" fill="none" stroke="#{fg}" stroke-opacity="0.18" stroke-width="2"/>
  <text x="400" y="380" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="200" fill="#{fg}" fill-opacity="0.9">{initials}</text>
  <text x="400" y="470" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="34" letter-spacing="4" fill="#{fg}" fill-opacity="0.65">{label}</text>
</svg>"""
    return Response(content=svg, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=86400"})
