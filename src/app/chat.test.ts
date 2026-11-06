import { describe, expect, it } from 'vitest';
import { deliveryOf, upsertMessage, type ThreadMessage } from './chat';

const msg = (key: string, seq: number | null, state: ThreadMessage['state'] = seq === null ? 'sending' : 'sent'): ThreadMessage => ({
  key,
  seq,
  mine: true,
  body: key,
  createdAt: '2026-11-06T00:00:00Z',
  state,
});

describe('friend chat thread', () => {
  it('replaces the pending copy whichever arrives first (socket or POST reply), never duplicates', () => {
    let list = [msg('a', 1), msg('p', null)];
    list = upsertMessage(list, msg('p', 5)); // stored copy of the pending one
    list = upsertMessage(list, msg('p', 5)); // the other path delivers it again
    expect(list.map((m) => [m.key, m.seq])).toEqual([['a', 1], ['p', 5]]);
  });

  it('keeps seq order, still-sending messages last', () => {
    let list = [msg('x', null), msg('b', 3)];
    list = upsertMessage(list, msg('a', 2));
    expect(list.map((m) => m.key)).toEqual(['a', 'b', 'x']);
  });

  it('shows spinner -> faint check -> deep check', () => {
    expect(deliveryOf(msg('p', null), 10)).toBe('sending');
    expect(deliveryOf(msg('f', null, 'failed'), 10)).toBe('failed');
    expect(deliveryOf(msg('s', 11), 10)).toBe('sent');
    expect(deliveryOf(msg('r', 10), 10)).toBe('read');
  });
});
