"""public sign-up: consent time, blocks, reports

Before opening sign-up to everyone:
- users.terms_agreed_at: when someone confirmed being 14+ and agreed to the
  privacy policy (NULL for accounts made during the code-only test period);
- user_blocks: who blocked whom;
- reports: reports about users, for the operator.

Only additions: existing rows are untouched. Downgrade drops them again.

Revision ID: 787ac0e56d2e
Revises: 9ef42a96338f
Create Date: 2026-11-07 15:40:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "787ac0e56d2e"
down_revision: str | None = "9ef42a96338f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("terms_agreed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "user_blocks",
        sa.Column("blocker_id", sa.UUID(), nullable=False),
        sa.Column("blocked_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("blocker_id <> blocked_id", name="user_blocks_not_self"),
        sa.ForeignKeyConstraint(["blocker_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blocked_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("blocker_id", "blocked_id"),
    )
    op.create_index(op.f("ix_user_blocks_blocked_id"), "user_blocks", ["blocked_id"], unique=False)
    op.create_table(
        "reports",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("reporter_id", sa.UUID(), nullable=True),
        sa.Column("target_id", sa.UUID(), nullable=True),
        sa.Column("target_nickname", sa.String(length=12), nullable=False),
        sa.Column("target_login_id", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.String(length=16), nullable=False),
        sa.Column("context", sa.String(length=16), server_default="other", nullable=False),
        sa.Column("detail", sa.String(length=300), server_default="", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="open", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("reason IN ('abuse', 'spam', 'sexual', 'privacy', 'other')", name="reports_reason_check"),
        sa.CheckConstraint("context IN ('chat', 'request', 'room', 'party', 'guestbook', 'other')", name="reports_context_check"),
        sa.CheckConstraint("status IN ('open', 'closed')", name="reports_status_check"),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_reports_reporter_id"), "reports", ["reporter_id"], unique=False)
    op.create_index(op.f("ix_reports_target_id"), "reports", ["target_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_reports_target_id"), table_name="reports")
    op.drop_index(op.f("ix_reports_reporter_id"), table_name="reports")
    op.drop_table("reports")
    op.drop_index(op.f("ix_user_blocks_blocked_id"), table_name="user_blocks")
    op.drop_table("user_blocks")
    op.drop_column("users", "terms_agreed_at")
