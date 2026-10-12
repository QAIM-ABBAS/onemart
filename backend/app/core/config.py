from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "OneMart API"
    environment: str = "development"

    # 127.0.0.1 rather than "localhost": Docker publishes the DB on the IPv4
    # loopback only, and a "localhost" lookup tries ::1 first and stalls for
    # ~2 minutes before falling back. Port stays 5433 (compose + README).
    database_url: str = "postgresql+psycopg://onemart:onemart@127.0.0.1:5433/onemart"
    redis_url: str = "redis://127.0.0.1:7500/0"
    redis_disabled: bool = False

    jwt_secret: str = "dev-only-secret-change-me-0123456789abcdef0123456789abcdef"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 14

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    cookie_secure: bool = False
    cookie_name: str = "onemart_refresh"
    cart_cookie_name: str = "om_cart"

    seed_on_startup: bool = False

    # --- Payments / stock reservation -------------------------------------
    # An online order exists before the money arrives, so its stock is held for
    # this long before the sweeper releases it and cancels the order.
    payment_reservation_minutes: int = 15
    # Currency stored on a payment row (the store's own money).
    payment_currency: str = "INR"
    # Where the gateway sends the customer back (SPA) and where it calls us
    # back (API). Both are absolute because the gateway resolves them itself.
    public_base_url: str = "http://localhost:5173"
    api_public_url: str = "http://localhost:8000"

    # Zarinpal gateway. An empty merchant id switches the adapter to its
    # built-in mock (local StartPay page) so checkout, callback and refunds
    # work end-to-end without network access — used by dev and the E2E suite.
    zarinpal_merchant_id: str = ""
    zarinpal_sandbox: bool = True
    # Empty → derived from the sandbox flag (sandbox.zarinpal.com / payment.zarinpal.com).
    zarinpal_base_url: str = ""
    # Currency code handed to the gateway alongside the numeric amount.
    zarinpal_currency: str = "TOMAN"
    zarinpal_timeout_seconds: float = 15.0

    # --- Delivery zones / slots -------------------------------------------
    # A slot is bookable only until this many hours before it starts.
    delivery_slot_cutoff_hours: int = 2

    # --- Promotional banners / media storage -------------------------------
    # Where uploaded creatives live. "local" writes under media_root and
    # serves them from GET /api/media/…; "s3" is any S3-compatible store
    # (AWS / MinIO / R2) reached through boto3 — install the `s3` extra.
    storage_backend: str = "local"
    # Relative paths resolve against the working dir (backend/ on the host,
    # /srv in the container — the bind mount keeps them the same directory).
    media_root: str = "media"
    media_max_upload_mb: int = 5
    # Rendered variants: the desktop image is capped at this width, the
    # phone one considerably narrower (both saved as WebP).
    media_desktop_max_width: int = 1600
    media_mobile_max_width: int = 750
    s3_endpoint_url: str = ""
    s3_region: str = ""
    s3_bucket: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    # Public URL prefix for stored objects (CDN or bucket website).
    s3_public_base_url: str = ""

    # Banner payloads are cached this long (invalidated on every admin
    # change); analytics events are rate-limited per client per minute and
    # one impression per banner is counted per client per dedup window.
    banner_cache_ttl: int = 60
    banner_track_rate_limit: int = 120
    banner_impression_dedup_seconds: int = 1800

    # Celery: the broker is `redis_url`. Tests flip this on so tasks execute
    # in-process — no worker and no broker connection anywhere in pytest.
    celery_task_always_eager: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
