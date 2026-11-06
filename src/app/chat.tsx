import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type ConversationSummary, type DirectMessage, type MessageHistory } from '../api/client';
import { useToast } from '../components/ui';
import { useAuth } from './auth';
import { useLive } from './live';

/**
 * Friend 1:1 chat state for the whole app: the open window, each thread's
 * messages (stored and still sending), unread counts, read receipts and
 * typing indicators. Messages are saved over HTTP (idempotent by client id)
 * and arrive live over the realtime connection. Separate from the in-room
 * speech bubbles.
 */

export interface ChatFriend {
  id: string;
  nickname: string;
}

export type SendState = 'sending' | 'sent' | 'failed';

export interface ThreadMessage {
  /** client_id: stable from the moment of sending, so the stored copy replaces the pending one. */
  key: string;
  seq: number | null;
  mine: boolean;
  body: string;
  createdAt: string;
  state: SendState;
  error?: string;
}

export interface Thread {
  friend: ChatFriend;
  messages: ThreadMessage[];
  hasMore: boolean;
  loading: boolean;
  /** Highest seq of theirs I've read / of mine they've read. */
  myReadSeq: number;
  peerReadSeq: number;
}

interface ChatApi {
  open: { friend: ChatFriend; minimized: boolean } | null;
  thread: Thread | null;
  unread: Record<string, number>;
  totalUnread: number;
  typing: Record<string, boolean>;
  openChat(friend: ChatFriend): void;
  closeChat(): void;
  setMinimized(minimized: boolean): void;
  send(text: string): void;
  retry(key: string): void;
  loadOlder(): Promise<void>;
  /** The open chat is really on screen: mark the friend's messages read (ChatWindow decides when). */
  markRead(): void;
  setTyping(on: boolean): void;
}

const ChatContext = createContext<ChatApi | null>(null);

/**
 * Puts a stored message into a thread: replaces the pending copy with the same
 * client id (or an earlier copy of the same message), else appends; keeps seq
 * order with still-sending messages last. Delivery over the socket and the
 * POST response can arrive in either order; the result is the same.
 */
export function upsertMessage(list: ThreadMessage[], m: ThreadMessage): ThreadMessage[] {
  const i = list.findIndex((x) => x.key === m.key);
  const next = i >= 0 ? list.map((x, j) => (j === i ? m : x)) : [...list, m];
  return next.sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));
}

/** How a message of mine shows: spinner while sending, faint check when stored, deep check once read. */
export function deliveryOf(m: ThreadMessage, peerReadSeq: number): 'sending' | 'failed' | 'sent' | 'read' {
  if (m.state !== 'sent' || m.seq === null) return m.state === 'failed' ? 'failed' : 'sending';
  return m.seq <= peerReadSeq ? 'read' : 'sent';
}

/** Typing indicator: re-sent at most every 3 s while typing, off after 5 s without keys; hidden after 6 s without news. */
const TYPING_RESEND_MS = 3000;
const TYPING_IDLE_MS = 5000;
const TYPING_SHOW_MS = 6000;

const newClientId = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '');

export function ChatProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const myId = me?.id ?? null;
  const { live } = useLive();
  const toast = useToast();
  const [open, setOpen] = useState<ChatApi['open']>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [typing, setTypingMap] = useState<Record<string, boolean>>({});
  // Threads are mutated in place; bumping the version re-renders the window.
  const [version, bump] = useState(0);
  const threads = useRef(new Map<string, Thread>());
  const names = useRef(new Map<string, string>());
  const openRef = useRef(open);
  openRef.current = open;
  const typingTimers = useRef(new Map<string, number>());
  const typingOut = useRef({ to: '', on: false, sentAt: 0, idle: 0 });
  const rerender = useCallback(() => bump((n) => n + 1), []);

  const toThread = (m: DirectMessage): ThreadMessage => ({
    key: m.client_id,
    seq: m.seq,
    mine: m.sender_id === myId,
    body: m.body,
    createdAt: m.created_at,
    state: 'sent',
  });

  const refreshSummary = useCallback(async () => {
    if (!myId) return;
    try {
      const list = await api<ConversationSummary[]>('GET', '/api/messages/conversations');
      for (const c of list) names.current.set(c.friend.id, c.friend.nickname);
      setUnread(Object.fromEntries(list.filter((c) => c.unread > 0).map((c) => [c.friend.id, c.unread])));
    } catch {
      /* keep the last known counts */
    }
  }, [myId]);

  const loadThread = useCallback(
    async (friend: ChatFriend) => {
      const t: Thread = threads.current.get(friend.id) ?? { friend, messages: [], hasMore: false, loading: true, myReadSeq: 0, peerReadSeq: 0 };
      t.loading = true;
      threads.current.set(friend.id, t);
      rerender();
      try {
        const h = await api<MessageHistory>('GET', `/api/messages/with/${friend.id}`);
        const pending = t.messages.filter((m) => m.state !== 'sent' && !h.messages.some((s) => s.client_id === m.key));
        t.messages = [...h.messages.map(toThread), ...pending];
        t.hasMore = h.has_more;
        t.myReadSeq = Math.max(t.myReadSeq, h.my_read_seq);
        t.peerReadSeq = Math.max(t.peerReadSeq, h.peer_read_seq);
      } catch (e) {
        toast(e instanceof ApiError ? e.detail.message : '대화를 불러오지 못했어요.');
      } finally {
        t.loading = false;
        rerender();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rerender, toast, myId],
  );

  // Start: unread counts; on every (re)connect: counts again and the open thread (messages may have arrived meanwhile).
  useEffect(() => {
    if (!myId) return;
    void refreshSummary();
  }, [myId, refreshSummary]);

  useEffect(() => {
    if (!live || !myId) return;
    const offs = [
      live.on('welcome', () => {
        void refreshSummary();
        const o = openRef.current;
        if (o) void loadThread(o.friend);
      }),
      live.on('dm.new', (msg) => {
        const m = msg.message as DirectMessage;
        if (!m || typeof m.seq !== 'number') return;
        const fromMe = m.sender_id === myId;
        const peer = fromMe ? m.recipient_id : m.sender_id;
        const t = threads.current.get(peer);
        if (t) t.messages = upsertMessage(t.messages, toThread(m));
        if (!fromMe) {
          setUnread((u) => ({ ...u, [peer]: (u[peer] ?? 0) + 1 }));
          setTypingMap((s) => ({ ...s, [peer]: false }));
          const o = openRef.current;
          if (!o || o.friend.id !== peer || o.minimized) {
            const name = names.current.get(peer) ?? t?.friend.nickname;
            toast(name ? `💬 ${name}님의 새 메시지가 왔어요.` : '💬 새 메시지가 왔어요.');
            if (!name) void refreshSummary();
          }
        }
        rerender();
      }),
      live.on('dm.read', (msg) => {
        const reader = String(msg.reader);
        const peer = String(msg.peer);
        const seq = Number(msg.seq);
        if (reader === myId) {
          // I read it here or on another device.
          const t = threads.current.get(peer);
          if (t) t.myReadSeq = Math.max(t.myReadSeq, seq);
          const left = t ? t.messages.filter((m) => !m.mine && (m.seq ?? 0) > t.myReadSeq).length : 0;
          setUnread((u) => ({ ...u, [peer]: left }));
          if (!t) void refreshSummary();
        } else {
          const t = threads.current.get(reader);
          if (t) t.peerReadSeq = Math.max(t.peerReadSeq, seq);
        }
        rerender();
      }),
      live.on('dm.typing', (msg) => {
        const from = String(msg.from);
        const on = msg.on === true;
        window.clearTimeout(typingTimers.current.get(from));
        setTypingMap((s) => ({ ...s, [from]: on }));
        if (on) typingTimers.current.set(from, window.setTimeout(() => setTypingMap((s) => ({ ...s, [from]: false })), TYPING_SHOW_MS));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [live, myId, refreshSummary, loadThread, rerender, toast]);

  // Logged out: forget everything.
  useEffect(() => {
    if (myId) return;
    threads.current.clear();
    setOpen(null);
    setUnread({});
    setTypingMap({});
  }, [myId]);

  const sendTyping = useCallback(
    (to: string, on: boolean) => {
      const s = typingOut.current;
      if (on) {
        const now = Date.now();
        if (!s.on || s.to !== to || now - s.sentAt >= TYPING_RESEND_MS) {
          live?.send({ t: 'dm.typing', to, on: true });
          s.sentAt = now;
        }
        s.on = true;
        s.to = to;
        window.clearTimeout(s.idle);
        s.idle = window.setTimeout(() => sendTyping(to, false), TYPING_IDLE_MS);
      } else if (s.on) {
        window.clearTimeout(s.idle);
        live?.send({ t: 'dm.typing', to: s.to, on: false });
        s.on = false;
      }
    },
    [live],
  );

  const post = useCallback(
    async (friendId: string, key: string, body: string) => {
      const t = threads.current.get(friendId);
      try {
        const m = await api<DirectMessage>('POST', `/api/messages/with/${friendId}`, { body, client_id: key });
        if (t && t.messages.some((x) => x.key === key)) t.messages = upsertMessage(t.messages, toThread(m));
      } catch (e) {
        const msg = t?.messages.find((x) => x.key === key);
        if (msg) {
          msg.state = 'failed';
          msg.error = e instanceof ApiError ? e.detail.message : '보내지 못했어요.';
        }
      }
      rerender();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rerender, myId],
  );

  const value = useMemo<ChatApi>(() => {
    const thread = open ? (threads.current.get(open.friend.id) ?? null) : null;
    return {
      open,
      thread,
      unread,
      totalUnread: Object.values(unread).reduce((a, b) => a + b, 0),
      typing,
      openChat(friend) {
        names.current.set(friend.id, friend.nickname);
        if (openRef.current && openRef.current.friend.id !== friend.id) sendTyping(openRef.current.friend.id, false);
        setOpen({ friend, minimized: false });
        void loadThread(friend);
      },
      closeChat() {
        if (openRef.current) sendTyping(openRef.current.friend.id, false);
        setOpen(null);
      },
      setMinimized(minimized) {
        if (minimized && openRef.current) sendTyping(openRef.current.friend.id, false);
        setOpen((o) => (o ? { ...o, minimized } : o));
      },
      send(text) {
        const o = openRef.current;
        const body = text.trim();
        if (!o || !body) return;
        const t = threads.current.get(o.friend.id);
        if (!t) return;
        const key = newClientId();
        t.messages.push({ key, seq: null, mine: true, body, createdAt: new Date().toISOString(), state: 'sending' });
        sendTyping(o.friend.id, false);
        rerender();
        void post(o.friend.id, key, body);
      },
      retry(key) {
        const o = openRef.current;
        const msg = o && threads.current.get(o.friend.id)?.messages.find((m) => m.key === key);
        if (!o || !msg) return;
        msg.state = 'sending';
        msg.error = undefined;
        rerender();
        void post(o.friend.id, key, msg.body);
      },
      async loadOlder() {
        const o = openRef.current;
        const t = o && threads.current.get(o.friend.id);
        const first = t?.messages.find((m) => m.seq !== null);
        if (!o || !t || !t.hasMore || !first) return;
        try {
          const h = await api<MessageHistory>('GET', `/api/messages/with/${o.friend.id}?before=${first.seq}`);
          t.messages = [...h.messages.map(toThread), ...t.messages];
          t.hasMore = h.has_more;
          rerender();
        } catch (e) {
          toast(e instanceof ApiError ? e.detail.message : '이전 메시지를 불러오지 못했어요.');
        }
      },
      markRead() {
        const o = openRef.current;
        const t = o && threads.current.get(o.friend.id);
        if (!o || !t) return;
        const latest = Math.max(0, ...t.messages.filter((m) => !m.mine && m.seq !== null).map((m) => m.seq as number));
        if (latest <= t.myReadSeq) return;
        t.myReadSeq = latest;
        setUnread((u) => ({ ...u, [o.friend.id]: 0 }));
        api('POST', `/api/messages/with/${o.friend.id}/read`, { up_to_seq: latest }).catch(() => {});
      },
      setTyping(on) {
        const o = openRef.current;
        if (o) sendTyping(o.friend.id, on);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unread, typing, loadThread, post, rerender, sendTyping, toast, version]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatApi {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat outside ChatProvider');
  return ctx;
}
