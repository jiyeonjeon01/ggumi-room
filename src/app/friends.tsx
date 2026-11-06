import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, type Friend, type FriendRequestItem } from '../api/client';
import { useLive } from './live';

interface Requests {
  incoming: FriendRequestItem[];
  outgoing: FriendRequestItem[];
}

interface FriendsApi {
  friends: Friend[] | null;
  requests: Requests | null;
  incomingCount: number;
  reload(): Promise<void>;
  /** Runs a friend action, then refreshes the lists. Returns the error message, if any. */
  run(fn: () => Promise<unknown>): Promise<string | null>;
}

const FriendsContext = createContext<FriendsApi | null>(null);

/** Fallback refresh for the request badge; changes also arrive over the realtime connection. */
const POLL_MS = 60_000;

/**
 * Friend list and pending requests, shared by every friends view (sidebar,
 * slide-over, bottom sheet) and the request-count badges.
 */
export function FriendsProvider({ children }: { children: ReactNode }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [requests, setRequests] = useState<Requests | null>(null);
  const { live } = useLive();

  const reload = useCallback(async () => {
    const [f, r] = await Promise.all([api<Friend[]>('GET', '/api/friends'), api<Requests>('GET', '/api/friends/requests')]);
    setFriends(f);
    setRequests(r);
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') reload().catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [reload]);

  // A request, acceptance or removal involving me happened elsewhere: refresh now.
  useEffect(() => live?.on('friends.changed', () => void reload().catch(() => {})), [live, reload]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      let error: string | null = null;
      try {
        await fn();
      } catch (e) {
        error = e instanceof ApiError ? e.detail.message : '처리하지 못했어요.';
      }
      await reload().catch(() => {});
      return error;
    },
    [reload],
  );

  const value = useMemo<FriendsApi>(
    () => ({ friends, requests, incomingCount: requests?.incoming.length ?? 0, reload, run }),
    [friends, requests, reload, run],
  );
  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}

export function useFriends(): FriendsApi {
  const ctx = useContext(FriendsContext);
  if (!ctx) throw new Error('useFriends outside FriendsProvider');
  return ctx;
}
