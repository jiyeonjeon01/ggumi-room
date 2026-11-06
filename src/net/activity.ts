/**
 * Real user activity for friend presence. Input events (keys, pointer, touch,
 * scroll, coming back to the tab) mark the user as active; the server hears
 * about it at most every 30 s. Heartbeats never count. Pure, so it can be
 * tested without a browser.
 */

export type Presence = 'online' | 'away' | 'offline';

/** How often an active tab tells the server (the away threshold is 5 minutes). */
export const ACTIVITY_SEND_MS = 30_000;

export class ActivityTracker {
  private lastInput: number;
  private lastSent = -Infinity;
  private interval = ACTIVITY_SEND_MS;

  constructor(now: number) {
    this.lastInput = now;
  }

  /** The server's away threshold: report at least four times within it (never more than every 30 s needed). */
  setAwayAfter(seconds: number): void {
    if (Number.isFinite(seconds) && seconds > 0) this.interval = Math.min(ACTIVITY_SEND_MS, (seconds * 1000) / 4);
  }

  /** Records input; returns true when it should be sent now. */
  input(now: number): boolean {
    this.lastInput = now;
    if (now - this.lastSent < this.interval) return false;
    this.lastSent = now;
    return true;
  }

  /** How long ago the last input was (reported when (re)connecting). */
  idleMs(now: number): number {
    return Math.max(0, now - this.lastInput);
  }

  /** A (re)connect just reported the idle time. */
  reported(now: number): void {
    this.lastSent = now;
  }
}

/** Events that mean a person is actually using the page. */
export const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

export const isPresence = (s: unknown): s is Presence => s === 'online' || s === 'away' || s === 'offline';
