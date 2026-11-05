import { useEffect, useState } from 'react';

/**
 * Minimal history-API router: the app only has a handful of routes, and the
 * nginx SPA fallback already serves index.html for every path.
 */
export type Route =
  | { name: 'home' }
  | { name: 'room'; id: string }
  | { name: 'invite'; token: string }
  | { name: 'login'; next: string }
  | { name: 'signup'; next: string }
  | { name: 'notFound' };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROOM_RE = new RegExp(`^/room/(${UUID})$`, 'i');
const INVITE_RE = /^\/invite\/([A-Za-z0-9_-]{32})$/;

/**
 * Only our own in-app paths may be used as a post-login destination, never a
 * full URL or protocol-relative "//host", so ?next= can't redirect off-site.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  const path = next.split(/[?#]/)[0] ?? '/';
  return path === '/' || ROOM_RE.test(path) || INVITE_RE.test(path) ? path : '/';
}

export function parse(pathname: string, search: string): Route {
  const params = new URLSearchParams(search);
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const room = ROOM_RE.exec(pathname);
  if (room?.[1]) return { name: 'room', id: room[1].toLowerCase() };
  const invite = INVITE_RE.exec(pathname);
  if (invite?.[1]) return { name: 'invite', token: invite[1] };
  if (pathname === '/login') return { name: 'login', next: safeNext(params.get('next')) };
  if (pathname === '/signup') return { name: 'signup', next: safeNext(params.get('next')) };
  if (/^\/invite\//.test(pathname)) return { name: 'invite', token: '' }; // malformed token -> "not found" card
  return { name: 'notFound' };
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.pathname, window.location.search));
  useEffect(() => {
    const onPop = () => setRoute(parse(window.location.pathname, window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

// ---------------------------------------------------------------- invite context

const PENDING_INVITE = 'ggumi:pending-invite';

/**
 * The invite being followed, kept in sessionStorage so a refresh or the trip
 * through sign-up doesn't lose it. It's a room-invite code (not a credential)
 * and is cleared once used.
 */
export const pendingInvite = {
  get(): string | null {
    try {
      const v = sessionStorage.getItem(PENDING_INVITE);
      return v && INVITE_RE.test(`/invite/${v}`) ? v : null;
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      sessionStorage.setItem(PENDING_INVITE, token);
    } catch {
      /* private mode: the ?next= path still carries it */
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(PENDING_INVITE);
    } catch {
      /* ignore */
    }
  },
};
