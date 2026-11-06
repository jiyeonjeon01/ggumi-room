import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ACTIVITY_EVENTS, ActivityTracker, isPresence, type Presence } from '../net/activity';
import { LiveConnection, liveUrl, type LiveStatus, type ServerMessage } from '../net/live';
import { useAuth } from './auth';

interface LiveApi {
  /** The realtime connection while logged in, else null. */
  live: LiveConnection | null;
  status: LiveStatus;
  /**
   * Friends' status by user id. Empty while not connected: without the
   * server we don't know, so nobody is shown as online.
   */
  presence: Record<string, Presence>;
}

const LiveContext = createContext<LiveApi>({ live: null, status: 'closed', presence: {} });

const presenceMap = (v: unknown): Record<string, Presence> =>
  Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).filter(([, s]) => isPresence(s))) as Record<string, Presence>;

/**
 * One realtime connection per tab while logged in. Logging out (or the
 * session ending) closes it; the server also closes it on logout. Also
 * reports real activity (throttled) and keeps friends' presence.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const userId = me?.id ?? null;
  const [live, setLive] = useState<LiveConnection | null>(null);
  const [status, setStatus] = useState<LiveStatus>('closed');
  const [presence, setPresence] = useState<Record<string, Presence>>({});

  useEffect(() => {
    if (!userId) return;
    const conn = new LiveConnection(liveUrl());
    const activity = new ActivityTracker(performance.now());

    const offs = [
      conn.onStatus((s) => {
        setStatus(s);
        if (s !== 'open') setPresence({});
      }),
      conn.on('welcome', (m) => {
        setPresence(presenceMap(m.presence));
        activity.setAwayAfter(Number(m.away_after_s));
        // Tell the server how long this tab has been idle (a background tab reconnecting isn't "online").
        const now = performance.now();
        conn.send({ t: 'activity', idle_ms: Math.round(activity.idleMs(now)) });
        activity.reported(now);
      }),
      conn.on('presence', (m: ServerMessage) => {
        if (typeof m.user_id === 'string' && isPresence(m.status)) setPresence((p) => ({ ...p, [m.user_id as string]: m.status as Presence }));
      }),
      conn.on('presence.list', (m) => setPresence(presenceMap(m.presence))),
      conn.on('friends.changed', (m) => setPresence((p) => ({ ...p, ...presenceMap(m.presence) }))),
    ];

    const onInput = () => {
      if (activity.input(performance.now())) conn.send({ t: 'activity' });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onInput(); // coming back to the tab
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onInput, { passive: true, capture: true });
    window.addEventListener('focus', onInput);
    document.addEventListener('visibilitychange', onVisible);
    const online = () => conn.retryNow();
    window.addEventListener('online', online);

    setLive(conn);
    conn.start();
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onInput, { capture: true });
      window.removeEventListener('focus', onInput);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', online);
      for (const off of offs) off();
      conn.stop();
      setLive(null);
      setStatus('closed');
      setPresence({});
    };
  }, [userId]);

  return <LiveContext.Provider value={{ live, status, presence }}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
