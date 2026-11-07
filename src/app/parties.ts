import { useCallback, useEffect, useState } from 'react';
import { api, type ActiveParties, type ActiveParty } from '../api/client';

/** Fallback refresh: head counts and closings change without telling this tab. */
const POLL_MS = 20_000;

/**
 * Server clock minus this device's clock, from a response's `now`. Countdowns
 * use it so a phone whose clock is a few minutes off still shows the real
 * closing time.
 */
export function clockOffset(serverNow: string, receivedAt: number): number {
  const t = Date.parse(serverNow);
  return Number.isFinite(t) ? t - receivedAt : 0;
}

/** Milliseconds until `closesAt` on the server's clock (never negative). */
export function remainingMs(closesAt: string, offset: number, deviceNow: number): number {
  return Math.max(0, Date.parse(closesAt) - (deviceNow + offset));
}

/** "29분 41초", "45초" (rounded up, so it never reads 0 before it really ends). */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}분 ${s}초` : `${s}초`;
}

/**
 * Open parties I may walk back into (hosted or joined), refreshed while the
 * page is visible and whenever `key` changes (e.g. entering another room).
 */
export function useActiveParties(key: string) {
  const [parties, setParties] = useState<ActiveParty[] | null>(null);
  const [offset, setOffset] = useState(0);

  const reload = useCallback(async () => {
    try {
      const sent = Date.now();
      const r = await api<ActiveParties>('GET', '/api/parties/active');
      // Halfway through the round trip is the best guess of when the server read its clock.
      setOffset(clockOffset(r.now, (sent + Date.now()) / 2));
      setParties(r.parties);
    } catch {
      /* keep the last list; the next poll retries */
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void reload(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload, key]);

  return { parties, offset, reload };
}

/** Re-renders every second while `on` (countdowns). */
export function useTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [on]);
  return now;
}
