from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.pagination import Page, PaginationParams
from app.modules.notifications import service
from app.modules.notifications.schemas import NotificationOut, ReadAllOut, UnreadCountOut
from app.modules.users.models import User

router = APIRouter(tags=["notifications"])

SORTS = "newest, oldest"


@router.get("/notifications", response_model=Page[NotificationOut])
def my_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: str = "newest",
    unread: bool = False,
):
    params = PaginationParams(page=page, page_size=page_size, sort=sort)
    return service.list_notifications(db, user, params, unread=unread)


@router.get("/notifications/unread-count", response_model=UnreadCountOut)
def my_unread_count(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return UnreadCountOut(count=service.unread_count(db, user))


@router.post("/notifications/read-all", response_model=ReadAllOut)
def mark_all(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return ReadAllOut(updated=service.mark_all_read(db, user))


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_one(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return service.mark_read(db, user, notification_id)
