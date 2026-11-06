"""room guestbook

Adds guestbook_entries (short notes in a room, soft-deleted) and
rooms.guestbook_enabled (true for every existing room). Nothing existing
changes; downgrade drops just these.

Revision ID: 819b76651fd7
Revises: 4048ffc5e5bf
Create Date: 2026-11-06 14:00:14.294837
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '819b76651fd7'
down_revision: str | None = '4048ffc5e5bf'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('guestbook_entries',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('author_id', sa.UUID(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('deleted_by', sa.UUID(), nullable=True),
    sa.CheckConstraint('char_length(body) BETWEEN 1 AND 100', name='guestbook_body_length'),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['deleted_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('guestbook_room_newest', 'guestbook_entries', ['room_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_guestbook_entries_author_id'), 'guestbook_entries', ['author_id'], unique=False)
    op.add_column('rooms', sa.Column('guestbook_enabled', sa.Boolean(), server_default=sa.text('true'), nullable=False))


def downgrade() -> None:
    op.drop_column('rooms', 'guestbook_enabled')
    op.drop_index(op.f('ix_guestbook_entries_author_id'), table_name='guestbook_entries')
    op.drop_index('guestbook_room_newest', table_name='guestbook_entries')
    op.drop_table('guestbook_entries')
