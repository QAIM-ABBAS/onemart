"""stock reservations + payment attempts (+ payment_status partially_refunded)

Revision ID: 0008_payments_reservations
Revises: 0007_report_indexes
Create Date: 2026-10-07

Phase 1 — an online order exists before the money arrives, so its stock is
*held* rather than sold:

* ``stock_reservations`` — one hold per order line; ``inventory.reserved`` is
  the running total of the active ones, which is what every availability read
  already subtracts;
* ``payments`` — one row per attempt (initiate → retry → refund), keeping the
  gateway's reference and raw response;
* ``orders.payment_deadline`` — when the hold lapses (null for COD);
* ``payment_status`` gains ``partially_refunded`` for partial admin refunds.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0008_payments_reservations"
down_revision: str | None = "0007_report_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stock_reservations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("variant_id", sa.Integer(), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("active", "consumed", "released", name="reservation_status"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["variant_id"], ["product_variants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_stock_reservations_order_id", "stock_reservations", ["order_id"], unique=False
    )
    op.create_index(
        "ix_stock_reservations_variant_id", "stock_reservations", ["variant_id"], unique=False
    )
    op.create_index(
        "ix_stock_reservations_expires_at", "stock_reservations", ["expires_at"], unique=False
    )
    op.create_index(
        "ix_stock_reservations_order_status",
        "stock_reservations",
        ["order_id", "status"],
        unique=False,
    )
    # The sweeper's own index: "active and past its deadline".
    op.create_index(
        "ix_stock_reservations_status_expires",
        "stock_reservations",
        ["status", "expires_at"],
        unique=False,
    )

    op.create_table(
        "payments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "initiated",
                "pending",
                "paid",
                "failed",
                "refunded",
                "partially_refunded",
                name="payment_attempt_status",
            ),
            nullable=False,
        ),
        sa.Column("provider_ref", sa.String(length=128), nullable=True),
        sa.Column("refunded_amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column(
            "raw_response",
            sa.JSON().with_variant(JSONB(), "postgresql"),
            nullable=False,
        ),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_payments_order_id", "payments", ["order_id"], unique=False)
    op.create_index("ix_payments_order_created", "payments", ["order_id", "created_at"], unique=False)
    op.create_index("ix_payments_status_created", "payments", ["status", "created_at"], unique=False)
    op.create_index("ix_payments_provider_ref", "payments", ["provider_ref"], unique=False)

    op.add_column("orders", sa.Column("payment_deadline", sa.DateTime(timezone=True), nullable=True))

    # New order-level payment state for partial refunds. PG12+ allows ADD VALUE
    # inside the migration transaction; the value is not read before commit.
    op.execute("ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'partially_refunded'")


def downgrade() -> None:
    # Postgres has no "DROP VALUE" for enums: rebuild the type without the
    # value. Orders still holding it are mapped back to 'refunded' — the
    # closest state that remains true once the concept of partial refunds
    # is taken away (money did move, and none of it is coming back).
    op.execute(
        """
        UPDATE orders
        SET payment_status = 'refunded'
        WHERE payment_status = 'partially_refunded'
        """
    )
    op.execute("ALTER TYPE payment_status RENAME TO payment_status_old")
    op.execute(
        "CREATE TYPE payment_status AS ENUM "
        "('pending', 'paid', 'failed', 'refunded')"
    )
    # The column default is typed as the old enum: drop it, cast, restore it.
    op.execute("ALTER TABLE orders ALTER COLUMN payment_status DROP DEFAULT")
    op.execute(
        "ALTER TABLE orders ALTER COLUMN payment_status TYPE payment_status "
        "USING payment_status::text::payment_status"
    )
    op.execute("ALTER TABLE orders ALTER COLUMN payment_status SET DEFAULT 'pending'")
    op.execute("DROP TYPE payment_status_old")

    op.drop_column("orders", "payment_deadline")

    op.drop_index("ix_payments_provider_ref", table_name="payments")
    op.drop_index("ix_payments_status_created", table_name="payments")
    op.drop_index("ix_payments_order_created", table_name="payments")
    op.drop_index("ix_payments_order_id", table_name="payments")
    op.drop_table("payments")

    op.drop_index("ix_stock_reservations_status_expires", table_name="stock_reservations")
    op.drop_index("ix_stock_reservations_order_status", table_name="stock_reservations")
    op.drop_index("ix_stock_reservations_expires_at", table_name="stock_reservations")
    op.drop_index("ix_stock_reservations_variant_id", table_name="stock_reservations")
    op.drop_index("ix_stock_reservations_order_id", table_name="stock_reservations")
    op.drop_table("stock_reservations")

    # Enum types outlive their tables in Postgres.
    op.execute("DROP TYPE IF EXISTS payment_attempt_status")
    op.execute("DROP TYPE IF EXISTS reservation_status")
