"""Schemas for the delivery endpoints (public quote/slot views + admin CRUD)."""

from datetime import date, time

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ZoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    postal_codes: list[str] = Field(default_factory=list)
    cities: list[str] = Field(default_factory=list)
    base_fee: float
    express_fee: float
    free_delivery_threshold: float | None = None
    is_active: bool


class ZoneWrite(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    postal_codes: list[str] = Field(default_factory=list)
    cities: list[str] = Field(default_factory=list)
    base_fee: float = Field(ge=0)
    express_fee: float = Field(ge=0)
    free_delivery_threshold: float | None = Field(default=None, ge=0)
    is_active: bool = True

    @field_validator("postal_codes", "cities")
    @classmethod
    def _strip_entries(cls, values: list[str]) -> list[str]:
        return [v.strip() for v in values if v and v.strip()]

    @field_validator("express_fee")
    @classmethod
    def _express_not_cheaper(cls, value: float, info) -> float:
        base = info.data.get("base_fee")
        if base is not None and value < base:
            raise ValueError("Express cannot cost less than standard delivery")
        return value


class ZoneMatchOut(BaseModel):
    """What checkout needs to know about an address."""

    serviceable: bool
    # False when the store has no zones yet (bootstrap: legacy flat fee).
    configured: bool
    zone: ZoneOut | None = None


class SlotOut(BaseModel):
    id: int
    date: date
    start: time
    end: time
    capacity: int
    booked_count: int
    state: str  # available | limited | full | closed


class QuoteIn(BaseModel):
    postal_code: str = Field(default="", max_length=20)
    city: str = Field(default="", max_length=120)
    delivery_method: str = Field(default="standard")


class TemplateWrite(BaseModel):
    weekday: int = Field(ge=0, le=6)  # Monday=0 .. Sunday=6
    start_time: time
    end_time: time
    capacity: int = Field(ge=1, le=200)

    @field_validator("end_time")
    @classmethod
    def _after_start(cls, value: time, info) -> time:
        start = info.data.get("start_time")
        if start is not None and value <= start:
            raise ValueError("End time must be after the start time")
        return value


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    zone_id: int
    weekday: int
    start_time: time
    end_time: time
    capacity: int


class GenerateIn(BaseModel):
    date_from: date
    days: int = Field(default=14, ge=1, le=60)


class BlockDateIn(BaseModel):
    date: date
    reason: str | None = Field(default=None, max_length=255)


class BlockedDateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    zone_id: int
    blocked_date: date
    reason: str | None = None


class BoardEntry(BaseModel):
    """One order on today's delivery board."""

    order_id: int
    order_number: str
    status: str
    recipient_name: str
    phone: str
    address: str
    slot_id: int | None
    slot_start: time | None = None
    slot_end: time | None = None
    # Orders with no slot (standard/express) group under this bucket.
    method: str
    total: float
    payment_status: str


class BoardGroup(BaseModel):
    slot_id: int | None = None
    start: time | None = None
    end: time | None = None
    orders: list[BoardEntry]


class BoardOut(BaseModel):
    date: date
    zone_id: int
    unscheduled: list[BoardEntry] = Field(default_factory=list)
    groups: list[BoardGroup] = Field(default_factory=list)


class StatusChangeIn(BaseModel):
    status: str
    note: str | None = Field(default=None, max_length=255)
