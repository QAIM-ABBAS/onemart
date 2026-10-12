"""promotional banners: per-placement creatives with scheduling + analytics

Revision ID: 0011_banners
Revises: 0010_flash_deals
Create Date: 2026-10-11

Phase 4 — the marketing banner engine:

* ``banners`` — one row per creative: where it renders (``placement``:
  home hero carousel / home mid strip / category header / cart promo),
  its copy, desktop + mobile images, where its CTA goes
  (``link_type``/``link_target``), when it runs, its display order and
  the impression/click counters the analytics flush writes into;
* ``category_header`` banners must point at a category, and only they may
  (CHECK enforces the pairing both ways);
* ``ck_banners_tone`` keeps the hero card contrast to light | brand;
* counters start at zero — events are buffered in Redis and flushed here
  by the ``banners.flush_stats`` Celery beat task, never written per view.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0011_banners"
down_revision: str | None = "0010_flash_deals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

banner_placement = sa.Enum(
    "home_hero", "home_mid_strip", "category_header", "cart_promo",
    name="banner_placement",
)
banner_link_type = sa.Enum(
    "product", "category", "coupon", "url", name="banner_link_type"
)


def upgrade() -> None:
    op.create_table(
        "banners",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("eyebrow", sa.String(length=60), nullable=True),
        sa.Column("subtitle", sa.String(length=255), nullable=True),
        sa.Column("cta_label", sa.String(length=60), nullable=True),
        sa.Column(
            "tone", sa.String(length=16), nullable=False, server_default="light"
        ),
        sa.Column("image_desktop", sa.String(length=500), nullable=False),
        sa.Column("image_mobile", sa.String(length=500), nullable=True),
        sa.Column("alt", sa.String(length=160), nullable=True),
        sa.Column("placement", banner_placement, nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("link_type", banner_link_type, nullable=False),
        sa.Column("link_target", sa.String(length=255), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("impressions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("clicks", sa.Integer(), nullable=False, server_default="0"),
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
        sa.CheckConstraint(
            "(placement = 'category_header') = (category_id IS NOT NULL)",
            name="ck_banners_category_placement",
        ),
        sa.CheckConstraint("tone IN ('light', 'brand')", name="ck_banners_tone"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_banners_category_id", "banners", ["category_id"])
    # The public query is always placement + active, ordered by priority.
    op.create_index("ix_banners_placement_active", "banners", ["placement", "is_active"])


def downgrade() -> None:
    op.drop_index("ix_banners_placement_active", table_name="banners")
    op.drop_index("ix_banners_category_id", table_name="banners")
    op.drop_table("banners")
    # Postgres enum types outlive their table — drop them explicitly.
    bind = op.get_bind()
    banner_placement.drop(bind, checkfirst=True)
    banner_link_type.drop(bind, checkfirst=True)
