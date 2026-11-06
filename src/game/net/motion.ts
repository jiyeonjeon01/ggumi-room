/**
 * Network movement helpers, pure (no Phaser/DOM):
 * - MoveReporter decides when the local player's position goes out (at most
 *   every 100 ms while walking, right away when stopping), so traffic stays
 *   around 10 small messages a second per walking player and 0 when idle.
 * - RemoteMotion turns those updates into smooth movement for other players:
 *   it draws them ~120 ms in the past, interpolating between the two updates
 *   around that moment, so uneven arrival times don't make them stutter.
 */

import type { Facing } from '../entities/Avatar';

export interface MoveState {
  x: number;
  y: number;
  f: Facing;
  s: 'idle' | 'walk';
}

export const SEND_INTERVAL_MS = 100;

export class MoveReporter {
  private last: MoveState | null = null;
  private lastAt = -Infinity;

  constructor(private readonly intervalMs = SEND_INTERVAL_MS) {}

  /** Call every frame; returns the state to send now, or null. */
  update(now: number, cur: MoveState): MoveState | null {
    const last = this.last;
    if (last && Math.hypot(cur.x - last.x, cur.y - last.y) < 1e-3 && cur.f === last.f && cur.s === last.s) return null;
    const stopped = last !== null && last.s === 'walk' && cur.s === 'idle';
    if (!stopped && now - this.lastAt < this.intervalMs) return null;
    this.last = { ...cur };
    this.lastAt = now;
    return this.last;
  }

  /** The next update is sent regardless (after joining or a server correction). */
  reset(): void {
    this.last = null;
    this.lastAt = -Infinity;
  }
}

/** How far in the past remote players are drawn. */
export const INTERP_DELAY_MS = 120;
/** Farther than this between two updates is a jump (teleport, layout change): no sliding. */
const SNAP_DISTANCE = 2.5;
const MAX_SNAPSHOTS = 30;

interface Snapshot extends MoveState {
  t: number;
}

export class RemoteMotion {
  private snaps: Snapshot[] = [];

  constructor(start: MoveState, now: number) {
    this.snaps.push({ ...start, t: now });
  }

  push(state: MoveState, now: number): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && Math.hypot(state.x - last.x, state.y - last.y) > SNAP_DISTANCE) {
      // A jump: start over from the new spot instead of gliding across the room.
      this.snaps = [{ ...state, t: now - INTERP_DELAY_MS }];
      return;
    }
    this.snaps.push({ ...state, t: Math.max(now, (last?.t ?? now) + 1) });
    if (this.snaps.length > MAX_SNAPSHOTS) this.snaps.splice(0, this.snaps.length - MAX_SNAPSHOTS);
  }

  /** Puts the player somewhere at once (e.g. our own correction of a stale spot). */
  jump(state: MoveState, now: number): void {
    this.snaps = [{ ...state, t: now - INTERP_DELAY_MS }];
  }

  sample(now: number): MoveState {
    const t = now - INTERP_DELAY_MS;
    const snaps = this.snaps;
    // Drop snapshots we have fully passed (keep the one just before t).
    while (snaps.length > 2 && (snaps[1] as Snapshot).t <= t) snaps.shift();
    const a = snaps[0] as Snapshot;
    const b = snaps[1];
    if (!b || t <= a.t) {
      // Nothing newer to move toward: hold the latest known spot.
      const last = snaps[snaps.length - 1] as Snapshot;
      return t >= last.t ? { x: last.x, y: last.y, f: last.f, s: last.s } : { x: a.x, y: a.y, f: a.f, s: a.s };
    }
    if (t >= b.t) return { x: b.x, y: b.y, f: b.f, s: b.s };
    const k = (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, f: b.f, s: b.s === 'idle' && k < 1 ? 'walk' : b.s };
  }
}
