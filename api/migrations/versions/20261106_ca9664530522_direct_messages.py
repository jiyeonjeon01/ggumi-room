"""direct messages

Adds conversations (one per pair of users, with each side's read position)
and messages. Only new tables: existing users, friends and rooms are untouched,
and downgrading drops just these two tables.

Revision ID: ca9664530522
Revises: 7b1d3e5f9a20
Create Date: 2026-11-06 11:46:27.118317
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'ca9664530522'
down_revision: str | None = '7b1d3e5f9a20'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('conversations',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_a_id', sa.UUID(), nullable=False),
    sa.Column('user_b_id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_message_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('a_read_seq', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('b_read_seq', sa.BigInteger(), server_default='0', nullable=False),
    sa.CheckConstraint('user_a_id < user_b_id', name='conversations_ordered_pair'),
    sa.ForeignKeyConstraint(['user_a_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_b_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('conversations_pair', 'conversations', ['user_a_id', 'user_b_id'], unique=True)
    op.create_index(op.f('ix_conversations_user_b_id'), 'conversations', ['user_b_id'], unique=False)
    op.create_table('messages',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('seq', sa.BigInteger(), sa.Identity(always=True), nullable=False),
    sa.Column('conversation_id', sa.UUID(), nullable=False),
    sa.Column('sender_id', sa.UUID(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('client_id', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('char_length(body) BETWEEN 1 AND 500', name='messages_body_length'),
    sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('seq')
    )
    op.create_index('messages_conversation_seq', 'messages', ['conversation_id', 'seq'], unique=False)
    op.create_index('messages_sender_client', 'messages', ['sender_id', 'client_id'], unique=True)


def downgrade() -> None:
    op.drop_index('messages_sender_client', table_name='messages')
    op.drop_index('messages_conversation_seq', table_name='messages')
    op.drop_table('messages')
    op.drop_index(op.f('ix_conversations_user_b_id'), table_name='conversations')
    op.drop_index('conversations_pair', table_name='conversations')
    op.drop_table('conversations')
