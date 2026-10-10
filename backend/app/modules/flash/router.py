"""Public flash-deal endpoints: the homepage strip and PDP badges."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user_optional
from app.modules.flash.schemas import DealOut
from app.modules.flash.service import active_payload
from app.modules.users.models import User

router = APIRouter(prefix="/deals", tags=["deals"])


@router.get("/active", response_model=list[DealOut])
def list_active_deals(
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    """Live deals with stock left — an empty list means "hide the strip".

    Per-user purchase remaining rides along for signed-in customers so the
    strip can grey out what they can no longer buy.
    """
    return active_payload(db, user_id=user.id if user is not None else None)
