"""Customer-facing delivery endpoints.

* ``GET /delivery/zones/match`` — is this address deliverable, and at what
  zone? Checkout calls it as the customer picks/types an address.
* ``GET /delivery/slots`` — the bookable grid for a zone (full/limited/
  available/closed states), bounded by the horizon so no pagination is
  needed; the admin management list is paginated separately.

Slot availability here is advisory — the booking decision always re-checks
under the row lock inside the checkout transaction (see service.book_slot).
"""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.modules.delivery import service as delivery_service
from app.modules.delivery.schemas import SlotOut, ZoneMatchOut, ZoneOut

router = APIRouter(prefix="/delivery", tags=["delivery"])


@router.get("/zones/match", response_model=ZoneMatchOut)
def match_zone(
    postal_code: str | None = Query(None, max_length=20),
    city: str | None = Query(None, max_length=120),
    db: Session = Depends(get_db),
):
    zone = delivery_service.match_zone(db, postal_code=postal_code, city=city)
    configured = delivery_service.zones_configured(db)
    if zone is None:
        # Unserviceable (zones exist, none matches) or bootstrap (no zones →
        # the caller falls back to the store-wide default fee).
        return ZoneMatchOut(serviceable=not configured, configured=configured, zone=None)
    return ZoneMatchOut(serviceable=True, configured=True, zone=ZoneOut.model_validate(zone))


@router.get("/slots", response_model=list[SlotOut])
def list_slots(
    zone_id: int = Query(ge=1),
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
):
    rows = delivery_service.list_slots(db, zone_id, date_from=date_from, date_to=date_to)
    return [SlotOut(**row) for row in rows]


@router.get("/methods")
def delivery_methods():
    """The methods checkout may choose (fee impact comes from the zone quote)."""
    return [
        {"code": "standard", "name": "Standard delivery"},
        {"code": "express", "name": "Express delivery"},
        {"code": "scheduled", "name": "Scheduled slot"},
    ]
