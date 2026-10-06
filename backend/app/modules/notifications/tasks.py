import logging

from app.core.celery_app import celery
from app.core.db import SessionLocal
from app.core.email import get_email_provider
from app.modules.users.models import User

logger = logging.getLogger("onemart")


@celery.task(name="notifications.send_email")
def send_email(user_id: int, subject: str, body: str | None, link: str | None) -> None:
    """The email leg of a notification, executed by Celery (in-process when eager).

    Deliberately tolerant: a missing user or a transport failure is logged, never
    raised back into the business transaction that produced the notification.
    """
    try:
        with SessionLocal() as db:
            user = db.get(User, user_id)
            if user is None:
                return
            text = "\n\n".join(
                part for part in (body, f"Open: {link}" if link else None) if part
            )
            get_email_provider().send(to=user.email, subject=subject, body=text)
    except Exception:
        logger.exception("notification email failed (user=%s subject=%r)", user_id, subject)
