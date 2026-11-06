/**
 * "Came in through an invite" hand-off from the invite page to the room, so
 * the room can offer a friend request to its owner.
 *
 * - The accept response is kept in sessionStorage for this tab only, and is
 *   used once (a normal visit from the friend list never has one).
 * - Invites already offered are remembered per user in localStorage, so a
 *   reload or opening the same link again doesn't ask again; a different
 *   invite (another room, or a newly made link) is judged on its own.
 */

export type InviteRelation = 'self' | 'none' | 'friend' | 'outgoing' | 'incoming';

export interface InviteArrival {
  room_id: string;
  invitation_id: string;
  owner_id: string;
  owner_nickname: string;
  relation: InviteRelation;
}

const ARRIVAL = 'ggumi:invite-arrival';
const OFFERED = (userId: string) => `ggumi:invite-offered:${userId}`;
const MAX_REMEMBERED = 50;

export const inviteArrival = {
  set(a: InviteArrival): void {
    try {
      sessionStorage.setItem(ARRIVAL, JSON.stringify(a));
    } catch {
      /* private mode: no prompt, the room still works */
    }
  },
  /** The arrival for this room, if any (others are left alone). */
  peek(roomId: string): InviteArrival | null {
    try {
      const a = JSON.parse(sessionStorage.getItem(ARRIVAL) ?? 'null') as InviteArrival | null;
      return a && a.room_id === roomId && typeof a.invitation_id === 'string' && typeof a.owner_nickname === 'string' ? a : null;
    } catch {
      return null;
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(ARRIVAL);
    } catch {
      /* ignore */
    }
  },
};

function offered(userId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OFFERED(userId)) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Whether to offer a friend request now; marks the invite as offered when it says yes. */
export function shouldOfferFriend(userId: string, a: InviteArrival): boolean {
  // Own room, already friends, or a request of mine is waiting: nothing to offer.
  // "incoming" (they asked me) is offered: saying yes accepts their request, as before.
  if (a.relation !== 'none' && a.relation !== 'incoming') return false;
  const seen = offered(userId);
  if (seen.includes(a.invitation_id)) return false;
  try {
    localStorage.setItem(OFFERED(userId), JSON.stringify([...seen, a.invitation_id].slice(-MAX_REMEMBERED)));
  } catch {
    /* can't remember: still fine to offer once now */
  }
  return true;
}
