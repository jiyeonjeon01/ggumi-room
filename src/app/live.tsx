import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LiveConnection, liveUrl, type LiveStatus } from '../net/live';
import { useAuth } from './auth';

interface LiveApi {
  /** The realtime connection while logged in, else null. */
  live: LiveConnection | null;
  status: LiveStatus;
}

const LiveContext = createContext<LiveApi>({ live: null, status: 'closed' });

/**
 * One realtime connection per tab while logged in. Logging out (or the
 * session ending) closes it; the server also closes it on logout.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const userId = me?.id ?? null;
  const [value, setValue] = useState<LiveApi>({ live: null, status: 'closed' });

  useEffect(() => {
    if (!userId) return;
    const live = new LiveConnection(liveUrl());
    const off = live.onStatus((status) => setValue({ live, status }));
    setValue({ live, status: live.status });
    live.start();
    const online = () => live.retryNow();
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      off();
      live.stop();
      setValue({ live: null, status: 'closed' });
    };
  }, [userId]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
