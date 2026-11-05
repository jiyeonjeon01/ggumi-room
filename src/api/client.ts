/**
 * Thin fetch wrapper for the FastAPI backend (same origin, /api/...).
 * Auth is an HttpOnly session cookie the browser sends automatically; this
 * module only adds the CSRF header (double-submit token from the readable
 * `ggumi_csrf` cookie) to unsafe requests. No tokens live in localStorage.
 */

export interface ApiErrorDetail {
  message: string;
  field?: string;
  status?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: ApiErrorDetail,
  ) {
    super(detail.message);
  }
}

const CSRF_COOKIE = 'ggumi_csrf';

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1] ?? '') : null;
}

async function csrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  const res = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  const body = (await res.json()) as { csrf_token: string };
  return readCookie(CSRF_COOKIE) ?? body.csrf_token;
}

function toDetail(status: number, body: unknown): ApiErrorDetail {
  const d = (body as { detail?: unknown } | null)?.detail;
  if (typeof d === 'string') return { message: d };
  if (d && typeof d === 'object' && 'message' in d) return d as ApiErrorDetail;
  if (Array.isArray(d)) return { message: '입력한 내용을 다시 확인해 주세요.' }; // pydantic validation list
  if (status === 429) return { message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' };
  if (status >= 500) return { message: '서버가 잠시 쉬고 있어요. 조금 뒤에 다시 시도해 주세요.' };
  return { message: '요청을 처리하지 못했어요.' };
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const sentToken = method !== 'GET' ? await csrfToken() : null;
  if (sentToken) headers['X-CSRF-Token'] = sentToken;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { message: '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.' });
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  // On the very first load, two requests can each be issued a CSRF cookie and
  // the later one wins; if ours was replaced meanwhile, retry once with it.
  if (res.status === 403 && sentToken && !retried && readCookie(CSRF_COOKIE) !== sentToken) {
    return api<T>(method, path, body, true);
  }
  if (!res.ok) throw new ApiError(res.status, toDetail(res.status, parsed));
  return parsed as T;
}

// ---------------------------------------------------------------- types

export type ThemeIdApi = 'pastel' | 'galaxy' | 'plant';

export interface Me {
  id: string;
  login_id: string;
  nickname: string;
  created_at: string;
  room_id: string;
}

export interface RoomInfo {
  id: string;
  name: string;
  theme: ThemeIdApi;
  owner_id: string;
  owner_nickname: string;
  access: 'owner' | 'friend' | 'guest';
  updated_at: string;
  layout_version: number;
  items: { type: string; x: number; y: number; facing: number }[];
}

export interface PublicUser {
  id: string;
  nickname: string;
  joined_at: string;
}

export interface SearchResult extends PublicUser {
  relation: 'none' | 'friend' | 'outgoing' | 'incoming';
  request_id: string | null;
}

export interface Friend extends PublicUser {
  room_id: string | null;
  since: string;
}

export interface FriendRequestItem {
  id: string;
  user: PublicUser;
  created_at: string;
}

export interface InvitePreview {
  status: 'valid' | 'expired' | 'revoked' | 'not_found';
  inviter_nickname: string | null;
  room_name: string | null;
  expires_at: string | null;
}
