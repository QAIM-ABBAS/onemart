"""pricing: coupons, redemptions, cart coupon and order discount columns

Revision ID: 0002_pricing_coupons
Revises: 0001_initial
Create Date: 2026-10-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_pricing_coupons"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

coupon_kind = sa.Enum("percent", "fixed", name="coupon_kind")


def upgrade() -> None:
    # NB: no explicit coupon_kind.create() — op.create_table creates the type
    # when it builds the column, and doing both raises DuplicateObject.
    op.create_table(
        "coupons",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("description", sa.String(255), nullable=True),
        sa.Column("kind", coupon_kind, nullable=False),
        sa.Column("value", sa.Numeric(12, 2), nullable=False),
        sa.Column("min_subtotal", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("max_discount", sa.Numeric(12, 2), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("usage_limit", sa.Integer(), nullable=True),
        sa.Column("per_user_limit", sa.Integer(), nullable=True),
        sa.Column("used_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_coupons_code", "coupons", ["code"], unique=True)

    op.create_table(
        "coupon_redemptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "coupon_id",
            sa.Integer(),
            sa.ForeignKey("coupons.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "order_id", sa.Integer(), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("coupon_id", "order_id", name="uq_coupon_redemption_order"),
    )
    op.create_index("ix_coupon_redemptions_coupon_id", "coupon_redemptions", ["coupon_id"])
    op.create_index("ix_coupon_redemptions_user_id", "coupon_redemptions", ["user_id"])
    op.create_index("ix_coupon_redemptions_order_id", "coupon_redemptions", ["order_id"])

    op.add_column("carts", sa.Column("coupon_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_carts_coupon_id", "carts", "coupons", ["coupon_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_carts_coupon_id", "carts", ["coupon_id"])

    op.add_column(
        "orders",
        sa.Column("discount_total", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )
    op.add_column("orders", sa.Column("coupon_id", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("coupon_code", sa.String(40), nullable=True))
    op.create_foreign_key(
        "fk_orders_coupon_id", "orders", "coupons", ["coupon_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_orders_coupon_id", "orders", ["coupon_id"])


def downgrade() -> None:
    op.drop_index("ix_orders_coupon_id", table_name="orders")
    op.drop_constraint("fk_orders_coupon_id", "orders", type_="foreignkey")
    op.drop_column("orders", "coupon_code")
    op.drop_column("orders", "coupon_id")
    op.drop_column("orders", "discount_total")

    op.drop_index("ix_carts_coupon_id", table_name="carts")
    op.drop_constraint("fk_carts_coupon_id", "carts", type_="foreignkey")
    op.drop_column("carts", "coupon_id")

    op.drop_table("coupon_redemptions")
    op.drop_table("coupons")
    coupon_kind.drop(op.get_bind(), checkfirst=True)
