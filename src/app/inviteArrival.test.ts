import { beforeEach, describe, expect, it } from 'vitest';
import { inviteArrival, shouldOfferFriend, type InviteArrival } from './inviteArrival';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const arrival = (over: Partial<InviteArrival> = {}): InviteArrival => ({
  room_id: 'room-1',
  invitation_id: 'inv-1',
  owner_id: 'owner',
  owner_nickname: '꾸미',
  relation: 'none',
  ...over,
});

beforeEach(() => {
  Object.assign(globalThis, { sessionStorage: memoryStorage(), localStorage: memoryStorage() });
});

describe('invite friend offer', () => {
  it('offers only when there is no friendship or request of mine yet', () => {
    expect(shouldOfferFriend('me', arrival({ relation: 'none' }))).toBe(true);
    expect(shouldOfferFriend('me', arrival({ invitation_id: 'i2', relation: 'incoming' }))).toBe(true); // they asked: yes accepts
    for (const relation of ['self', 'friend', 'outgoing'] as const) {
      expect(shouldOfferFriend('me', arrival({ invitation_id: `x-${relation}`, relation }))).toBe(false);
    }
  });

  it('asks once per invite (reloads, same link again), but a different invite is its own question', () => {
    expect(shouldOfferFriend('me', arrival())).toBe(true);
    expect(shouldOfferFriend('me', arrival())).toBe(false);
    expect(shouldOfferFriend('me', arrival({ invitation_id: 'inv-2' }))).toBe(true);
    expect(shouldOfferFriend('someone-else', arrival())).toBe(true); // remembered per user
  });

  it('hands the arrival to that room only, once', () => {
    inviteArrival.set(arrival());
    expect(inviteArrival.peek('other-room')).toBeNull(); // a normal visit elsewhere
    expect(inviteArrival.peek('room-1')?.owner_nickname).toBe('꾸미');
    inviteArrival.clear();
    expect(inviteArrival.peek('room-1')).toBeNull();
  });
});
