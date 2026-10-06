"""reports: window indexes for the dashboard aggregates

Revision ID: 0007_report_indexes
Revises: 0006_discounts
Create Date: 2026-10-06

Every report query is a half-open window scan: orders by placed_at (KPIs,
series, status breakdown, recent orders, CSV export) and users by created_at
(the new-customers KPI). Both columns were unindexed; the joins through
order_items (top products, category roll-up) ride orders.placed_at via the
order_id foreign-key index that already exists.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007_report_indexes"
down_revision: str | None = "0006_discounts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_orders_placed_at", "orders", ["placed_at"])
    op.create_index("ix_users_created_at", "users", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_users_created_at", table_name="users")
    op.drop_index("ix_orders_placed_at", table_name="orders")
