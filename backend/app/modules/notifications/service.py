import logging
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.core.pagination import Page, PaginationParams
from app.modules.notifications.models import Notification, NotificationType
from app.modules.notifications.schemas import NotificationOut
from app.modules.users.models import User

logger = logging.getLogger("onemart")


def notify(
    db: Session,
    *,
    user_id: int,
    type: NotificationType,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> Notification:
    """Append a notification to the caller's transaction — no commit here on
    purpose: the row exists iff the action it reports is committed (the same
    contract as `audit.record`).

    The email leg goes out through Celery + the EmailProvider and is best-effort:
    a broker outage must never roll back the order/status change it reports.
    Callers invoke this right before their commit, so a rollback after that
    point can at worst leave an email whose row never landed — accepted for
    keeping `notify()` inside the caller's transaction.
    """
    row = Notification(user_id=user_id, type=type.value, title=title, body=body, link=link)
    db.add(row)
    db.flush()
    try:
        from app.modules.notifications.tasks import send_email

        send_email.delay(user_id=user_id, subject=title, body=body, link=link)
    except Exception:
        logger.warning("notification email dispatch failed for user %s", user_id, exc_info=True)
    return row


def list_notifications(
    db: Session, user: User, params: PaginationParams, *, unread: bool = False
) -> Page[NotificationOut]:
    filters = [Notification.user_id == user.id]
    if unread:
        filters.append(Notification.read_at.is_(None))

    total = (
        db.scalar(select(func.count()).select_from(Notification).where(*filters)) or 0
    )
    sort_map = {
        "newest": Notification.created_at.desc(),
        "oldest": Notification.created_at.asc(),
    }
    rows = db.scalars(
        select(Notification)
        .where(*filters)
        .order_by(sort_map.get(params.sort, sort_map["newest"]), Notification.id.desc())
        .offset(params.offset)
        .limit(params.page_size)
    ).all()

    items = [NotificationOut.model_validate(row) for row in rows]
    pages = max((total + params.page_size - 1) // params.page_size, 1) if total else 1
    return Page[NotificationOut](
        items=items, total=total, page=params.page, page_size=params.page_size, pages=pages
    )


def unread_count(db: Session, user: User) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        )
        or 0
    )


def mark_read(db: Session, user: User, notification_id: int) -> Notification:
    row = db.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user.id
        )
    )
    if row is None:
        raise NotFoundError("Notification not found")
    if row.read_at is None:
        row.read_at = datetime.now(UTC)
        db.commit()
    return row


def mark_all_read(db: Session, user: User) -> int:
    result = db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    db.commit()
    return result.rowcount or 0
