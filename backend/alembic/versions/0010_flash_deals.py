"""flash deals: timed stock-limited sale prices

Revision ID: 0010_flash_deals
Revises: 0009_delivery_slots
Create Date: 2026-10-10

Phase 3 — sale events that price below the regular discount stack:

* ``flash_deals`` — the named event with its window (start/end) and an
  on/off switch ("end early" pulls ``ends_at`` back to now instead);
* ``flash_deal_items`` — one variant per deal with either an absolute
  ``deal_price`` or a ``deal_percent`` off (CHECK enforces exactly one),
  the deal-stock counter checkout increments under a row lock, and an
  optional per-customer limit;
* ``coupons`` gains ``exclude_flash_deals`` — a coupon flagged with it
  computes its goods discount on the non-flash part of the basket only;
* ``order_items`` gains a (SET NULL) reference to the deal item so the
  sold counter can be given back when the order is cancelled or times
  out, and per-user limits can count previous orders.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0010_flash_deals"
down_revision: str | None = "0009_delivery_slots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MONEY = sa.Numeric(precision=12, scale=2)


def upgrade() -> None:
    op.create_table(
        "flash_deals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "flash_deal_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("deal_id", sa.Integer(), nullable=False),
        sa.Column("variant_id", sa.Integer(), nullable=False),
        sa.Column("deal_price", MONEY, nullable=True),
        sa.Column("deal_percent", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column("deal_stock_limit", sa.Integer(), nullable=False),
        sa.Column("deal_stock_sold", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("per_user_limit", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(deal_price IS NULL) <> (deal_percent IS NULL)",
            name="ck_flash_deal_item_price_xor",
        ),
        sa.ForeignKeyConstraint(["deal_id"], ["flash_deals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["variant_id"], ["product_variants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("deal_id", "variant_id", name="uq_flash_deal_item"),
    )
    op.create_index("ix_flash_deal_items_deal_id", "flash_deal_items", ["deal_id"])
    op.create_index("ix_flash_deal_items_variant_id", "flash_deal_items", ["variant_id"])

    op.add_column(
        "coupons",
        sa.Column("exclude_flash_deals", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.add_column(
        "orders",
        sa.Column("flash_released", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.add_column("order_items", sa.Column("flash_deal_item_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_order_items_flash_deal_item",
        "order_items",
        "flash_deal_items",
        ["flash_deal_item_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_order_items_flash_deal_item_id", "order_items", ["flash_deal_item_id"]
    )


def downgrade() -> None:
    op.drop_column("orders", "flash_released")

    op.drop_index("ix_order_items_flash_deal_item_id", table_name="order_items")
    op.drop_constraint(
        "fk_order_items_flash_deal_item", "order_items", type_="foreignkey"
    )
    op.drop_column("order_items", "flash_deal_item_id")

    op.drop_column("coupons", "exclude_flash_deals")

    op.drop_index("ix_flash_deal_items_variant_id", table_name="flash_deal_items")
    op.drop_index("ix_flash_deal_items_deal_id", table_name="flash_deal_items")
    op.drop_table("flash_deal_items")
    op.drop_table("flash_deals")
