from celery import Celery

from app.core.config import settings

# Broker is the compose Redis (`REDIS_URL`). Under `CELERY_TASK_ALWAYS_EAGER`
# (tests) tasks run in-process and nothing ever connects to the broker.
celery = Celery(
    "onemart",
    broker=settings.redis_url,
    include=["app.modules.notifications.tasks"],
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    task_always_eager=settings.celery_task_always_eager,
    task_eager_propagates=True,
    broker_connection_retry_on_startup=True,
)
