from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "OneMart API"
    environment: str = "development"

    database_url: str = "postgresql+psycopg://onemart:onemart@localhost:5433/onemart"
    redis_url: str = "redis://localhost:7500/0"
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

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
