"""discounts: automatic discount rules + free_delivery coupon kind

Revision ID: 0006_discounts
Revises: 0005_notifications
Create Date: 2026-10-06

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_discounts"
down_revision: str | None = "0005_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

discount_scope = sa.Enum("product", "category", name="discount_scope")
discount_kind = sa.Enum("percent", "fixed", name="discount_kind")


def upgrade() -> None:
    # Extend coupon_kind with 'free_delivery'. ALTER TYPE ... ADD VALUE is a
    # no-op when the label is already there, so a downgrade -> upgrade cycle
    # still works. The new label is not read anywhere in this transaction.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum e
                JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = 'coupon_kind' AND e.enumlabel = 'free_delivery'
            ) THEN
                ALTER TYPE coupon_kind ADD VALUE 'free_delivery';
            END IF;
        END
        $$;
        """
    )

    # NB: no explicit discount_scope/discount_kind.create() — op.create_table
    # creates the types when it builds the columns (same as 0002).
    op.create_table(
        "discounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("scope", discount_scope, nullable=False),
        sa.Column("kind", discount_kind, nullable=False),
        sa.Column("value", sa.Numeric(12, 2), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=True),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="CASCADE"), nullable=True),
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
    )
    op.create_index("ix_discounts_product_id", "discounts", ["product_id"])
    op.create_index("ix_discounts_category_id", "discounts", ["category_id"])
    op.create_index(
        "ix_discounts_active_window", "discounts", ["is_active", "starts_at", "ends_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_discounts_active_window", table_name="discounts")
    op.drop_index("ix_discounts_category_id", table_name="discounts")
    op.drop_index("ix_discounts_product_id", table_name="discounts")
    op.drop_table("discounts")
    discount_kind.drop(op.get_bind(), checkfirst=True)
    discount_scope.drop(op.get_bind(), checkfirst=True)
    # coupon_kind keeps the 'free_delivery' label: PostgreSQL 16 cannot DROP a
    # value from an enum, and recreating the type would break any row that used
    # it. The label is harmless and the upgrade above is written to tolerate it.
