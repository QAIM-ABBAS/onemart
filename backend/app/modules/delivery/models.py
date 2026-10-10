"""Delivery zones, bookable time slots, and the admin schedules behind them.

* A **zone** matches an address by PIN-code prefix or city name and carries
  the money rules (base fee, express uplift, free-delivery threshold).
* A **slot** is one bookable window per zone/date/time with a capacity that
  checkout increments under a row lock — the same pattern as stock.
* A **blocked date** makes every slot of that zone unbookable for a day
  (holidays, service pauses) without deleting rows, so bookings and the
  weekly template survive the block.
* A **template** is the weekly recipe ("Mon 09:00–12:00, cap 5") the admin
  generator turns into concrete slots.
"""

from datetime import date, time

from sqlalchemy import (
    JSON,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.types import TimestampMixin

# JSONB on Postgres, generic JSON elsewhere (same pattern as payments.raw_response
# in the 0008 migration) — the zone lists are read whole on every match.
JSON_LIST = JSON().with_variant(JSONB(), "postgresql")
MONEY = Numeric(12, 2)

# Delivery methods the checkout may choose. "scheduled" additionally requires
# a booked slot; the fee rules are per-zone (see delivery.service.delivery_spec).
METHOD_STANDARD = "standard"
METHOD_EXPRESS = "express"
METHOD_SCHEDULED = "scheduled"
DELIVERY_METHODS = (METHOD_STANDARD, METHOD_EXPRESS, METHOD_SCHEDULED)


class DeliveryZone(TimestampMixin, Base):
    __tablename__ = "delivery_zones"
    __table_args__ = (
        # The checkout match loop reads the active zones on every priced
        # summary — this partial index keeps that list tiny.
        Index("ix_delivery_zones_active", "is_active"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # PIN-code prefixes the zone covers, e.g. ["560", "561"] matches 560001.
    postal_codes: Mapped[list] = mapped_column(JSON_LIST, nullable=False, default=list)
    # City names (case-insensitive, exact) the zone covers, e.g. ["Bengaluru"].
    cities: Mapped[list] = mapped_column(JSON_LIST, nullable=False, default=list)
    base_fee: Mapped[object] = mapped_column(MONEY, nullable=False)
    # What Express costs (must be >= base_fee; validated on write).
    express_fee: Mapped[object] = mapped_column(MONEY, nullable=False)
    # Orders at/above this goods amount pay no delivery; null = never free
    # (only a free_delivery coupon can waive it then).
    free_delivery_threshold: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    is_active: Mapped[bool] = mapped_column(nullable=False, default=True)

    slots: Mapped[list["DeliverySlot"]] = relationship(
        back_populates="zone", cascade="all, delete-orphan"
    )


class DeliverySlot(TimestampMixin, Base):
    __tablename__ = "delivery_slots"
    __table_args__ = (
        UniqueConstraint("zone_id", "slot_date", "start_time", name="uq_delivery_slot_window"),
        Index("ix_delivery_slots_zone_date", "zone_id", "slot_date"),
        # The bookable-slots query: "this zone, from this date forward".
        Index("ix_delivery_slots_date", "slot_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    zone_id: Mapped[int] = mapped_column(
        ForeignKey("delivery_zones.id", ondelete="CASCADE"), index=True, nullable=False
    )
    slot_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Incremented under SELECT ... FOR UPDATE inside the checkout transaction.
    booked_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    zone: Mapped[DeliveryZone] = relationship(back_populates="slots")


class DeliveryBlockedDate(TimestampMixin, Base):
    """A day the zone does not deliver (block, don't delete, so bookings and
    the weekly template survive)."""

    __tablename__ = "delivery_blocked_dates"
    __table_args__ = (
        UniqueConstraint("zone_id", "blocked_date", name="uq_delivery_blocked_day"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    zone_id: Mapped[int] = mapped_column(
        ForeignKey("delivery_zones.id", ondelete="CASCADE"), index=True, nullable=False
    )
    blocked_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(255))


class DeliverySlotTemplate(TimestampMixin, Base):
    """Weekly recipe the admin generator turns into concrete slots.

    ``weekday`` uses ISO numbering: Monday=0 … Sunday=6.
    """

    __tablename__ = "delivery_slot_templates"
    __table_args__ = (
        UniqueConstraint(
            "zone_id", "weekday", "start_time", name="uq_delivery_template_window"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    zone_id: Mapped[int] = mapped_column(
        ForeignKey("delivery_zones.id", ondelete="CASCADE"), index=True, nullable=False
    )
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)  # Monday=0..Sunday=6
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
