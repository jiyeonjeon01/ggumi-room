/**
 * The realtime connection (/ws/live): one WebSocket per tab, shared by room
 * sync, friend presence and messages. It reconnects on its own with backoff,
 * pings every 20 s (the server drops silent sockets after 60 s), and stops for
 * good when the server says the session is gone (4401) or the page isn't
 * allowed (4403). Pure TypeScript: the socket and timers can be injected.
 */

export type LiveStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'unauthorized';

export interface ServerMessage {
  t: string;
  [key: string]: unknown;
}

type Listener = (msg: ServerMessage) => void;

interface SocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number): void;
}

export interface LiveOptions {
  createSocket?: (url: string) => SocketLike;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  random?: () => number;
  pingMs?: number;
}

const OPEN = 1;
/** Close codes after which retrying can't help. */
const FINAL_CODES = new Set([4401, 4403]);
const MAX_BACKOFF_MS = 15_000;

export function liveUrl(loc: { protocol: string; host: string } = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws/live`;
}

export class LiveConnection {
  status: LiveStatus = 'closed';
  /** Server-assigned id of this connection (room member id), once welcomed. */
  connId: string | null = null;
  private socket: SocketLike | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private statusListeners = new Set<(s: LiveStatus) => void>();
  private attempt = 0;
  private retryTimer: unknown = null;
  private pingTimer: unknown = null;
  private stopped = true;
  private readonly o: Required<LiveOptions>;

  constructor(
    private readonly url: string,
    options: LiveOptions = {},
  ) {
    this.o = {
      createSocket: options.createSocket ?? ((u) => new WebSocket(u) as unknown as SocketLike),
      setTimeout: options.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms)),
      clearTimeout: options.clearTimeout ?? ((id) => window.clearTimeout(id as number)),
      setInterval: options.setInterval ?? ((fn, ms) => window.setInterval(fn, ms)),
      clearInterval: options.clearInterval ?? ((id) => window.clearInterval(id as number)),
      random: options.random ?? Math.random,
      pingMs: options.pingMs ?? 20_000,
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open('connecting');
  }

  /** Closes for good (logout, page left). */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.close(1000);
    }
    this.setStatus('closed');
  }

  /** Reconnects now instead of waiting for the backoff (e.g. the browser came back online). */
  retryNow(): void {
    if (this.stopped || this.status === 'open' || this.status === 'unauthorized') return;
    if (this.retryTimer !== null) {
      this.o.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (!this.socket) this.open('reconnecting');
  }

  /** Sends when connected; returns false (and drops the message) otherwise. */
  send(msg: { t: string; [key: string]: unknown }): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify(msg));
    return true;
  }

  on(type: string, fn: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  onStatus(fn: (s: LiveStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private setStatus(s: LiveStatus): void {
    if (s === this.status) return;
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  private open(status: LiveStatus): void {
    this.setStatus(status);
    let socket: SocketLike;
    try {
      socket = this.o.createSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.pingTimer = this.o.setInterval(() => this.send({ t: 'ping' }), this.o.pingMs);
    };
    socket.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'welcome') {
        this.connId = typeof msg.id === 'string' ? msg.id : null;
        // "open" only once the server accepted the session, so listeners can join rooms.
        this.setStatus('open');
      }
      for (const fn of this.listeners.get(msg.t) ?? []) fn(msg);
    };
    socket.onerror = () => {};
    socket.onclose = (ev) => {
      this.clearTimers();
      this.socket = null;
      this.connId = null;
      if (this.stopped) return;
      if (FINAL_CODES.has(ev.code)) {
        this.stopped = true;
        this.setStatus('unauthorized');
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    this.setStatus('reconnecting');
    // 1 s, 2 s, 4 s ... up to 15 s, with jitter so a server restart isn't hit by every tab at once.
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    this.attempt++;
    const delay = base * (0.5 + this.o.random() * 0.5);
    this.retryTimer = this.o.setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.open('reconnecting');
    }, delay);
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) this.o.clearInterval(this.pingTimer);
    if (this.retryTimer !== null) this.o.clearTimeout(this.retryTimer);
    this.pingTimer = this.retryTimer = null;
  }
}
