"""delivery zones + bookable time slots

Revision ID: 0009_delivery_slots
Revises: 0008_payments_reservations
Create Date: 2026-10-10

Phase 2 — where and when an order can arrive:

* ``delivery_zones`` — PIN-prefix/city matching plus the money rules (base
  fee, express uplift, free-delivery threshold);
* ``delivery_slots`` — one bookable window per zone/date/time with a
  capacity checkout increments under a row lock (same pattern as stock);
* ``delivery_blocked_dates`` — days a zone does not deliver (block, never
  delete, so bookings and the weekly template survive);
* ``delivery_slot_templates`` — the weekly recipe the generator turns into
  concrete slots;
* ``orders`` gains the delivery method and (SET NULL) zone/slot references —
  the fee itself stays in the existing ``delivery_fee`` snapshot column.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0009_delivery_slots"
down_revision: str | None = "0008_payments_reservations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_LIST = sa.JSON().with_variant(JSONB(), "postgresql")
MONEY = sa.Numeric(precision=12, scale=2)


def upgrade() -> None:
    op.create_table(
        "delivery_zones",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("postal_codes", JSON_LIST, nullable=False),
        sa.Column("cities", JSON_LIST, nullable=False),
        sa.Column("base_fee", MONEY, nullable=False),
        sa.Column("express_fee", MONEY, nullable=False),
        sa.Column("free_delivery_threshold", MONEY, nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_delivery_zones_active", "delivery_zones", ["is_active"], unique=False)

    op.create_table(
        "delivery_slots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("zone_id", sa.Integer(), nullable=False),
        sa.Column("slot_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("booked_count", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["zone_id"], ["delivery_zones.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("zone_id", "slot_date", "start_time", name="uq_delivery_slot_window"),
    )
    op.create_index("ix_delivery_slots_zone_id", "delivery_slots", ["zone_id"], unique=False)
    op.create_index(
        "ix_delivery_slots_zone_date", "delivery_slots", ["zone_id", "slot_date"], unique=False
    )
    op.create_index("ix_delivery_slots_date", "delivery_slots", ["slot_date"], unique=False)

    op.create_table(
        "delivery_blocked_dates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("zone_id", sa.Integer(), nullable=False),
        sa.Column("blocked_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["zone_id"], ["delivery_zones.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("zone_id", "blocked_date", name="uq_delivery_blocked_day"),
    )
    op.create_index(
        "ix_delivery_blocked_dates_zone_id",
        "delivery_blocked_dates",
        ["zone_id"],
        unique=False,
    )

    op.create_table(
        "delivery_slot_templates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("zone_id", sa.Integer(), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["zone_id"], ["delivery_zones.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "zone_id", "weekday", "start_time", name="uq_delivery_template_window"
        ),
    )
    op.create_index(
        "ix_delivery_slot_templates_zone_id",
        "delivery_slot_templates",
        ["zone_id"],
        unique=False,
    )

    op.add_column(
        "orders", sa.Column("delivery_method", sa.String(length=20), nullable=False, server_default="standard")
    )
    op.add_column("orders", sa.Column("delivery_zone_id", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("delivery_slot_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_orders_delivery_zone",
        "orders",
        "delivery_zones",
        ["delivery_zone_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_orders_delivery_slot",
        "orders",
        "delivery_slots",
        ["delivery_slot_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_orders_delivery_zone_id", "orders", ["delivery_zone_id"], unique=False)
    op.create_index("ix_orders_delivery_slot_id", "orders", ["delivery_slot_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_orders_delivery_slot_id", table_name="orders")
    op.drop_index("ix_orders_delivery_zone_id", table_name="orders")
    op.drop_constraint("fk_orders_delivery_slot", "orders", type_="foreignkey")
    op.drop_constraint("fk_orders_delivery_zone", "orders", type_="foreignkey")
    op.drop_column("orders", "delivery_slot_id")
    op.drop_column("orders", "delivery_zone_id")
    op.drop_column("orders", "delivery_method")

    op.drop_index("ix_delivery_slot_templates_zone_id", table_name="delivery_slot_templates")
    op.drop_table("delivery_slot_templates")

    op.drop_index("ix_delivery_blocked_dates_zone_id", table_name="delivery_blocked_dates")
    op.drop_table("delivery_blocked_dates")

    op.drop_index("ix_delivery_slots_date", table_name="delivery_slots")
    op.drop_index("ix_delivery_slots_zone_date", table_name="delivery_slots")
    op.drop_index("ix_delivery_slots_zone_id", table_name="delivery_slots")
    op.drop_table("delivery_slots")

    op.drop_index("ix_delivery_zones_active", table_name="delivery_zones")
    op.drop_table("delivery_zones")
