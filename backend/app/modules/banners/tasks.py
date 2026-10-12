"""Banner analytics flush — the only place counters reach Postgres.

Clients buffer impressions/clicks in Redis (``bstats:*``); this beat task
drains them once a minute. Losing a worker tick is harmless: counters keep
accumulating until the next successful flush.
"""

from app.core.celery_app import celery
from app.core.db import SessionLocal
from app.modules.banners.service import flush_stats


@celery.task(name="banners.flush_stats")
def flush_banner_stats() -> int:
    """Celery beat entry point (every minute). Returns banners updated."""
    with SessionLocal() as db:
        return flush_stats(db)
