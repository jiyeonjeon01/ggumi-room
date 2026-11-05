import { DEFAULT_TIME_ZONE, msUntilNextPeriod, periodAt, type Period } from './timeOfDay';

/** 'auto' follows the real clock; a period name pins it (dev/testing). */
export type TimeMode = 'auto' | Period;

/**
 * Decides the current period and notifies when it changes.
 * In auto mode it sleeps until the next boundary (one timeout, no polling)
 * and re-checks whenever the tab becomes visible again, since background
 * tabs throttle timers and laptops sleep.
 */
export class TimeOfDayClock {
  private mode: TimeMode = 'auto';
  private current: Period;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(p: Period) => void>();
  /** Dev/test only: shifts "now" to simulate other times of day. */
  private offsetMs = 0;

  constructor(private readonly timeZone = DEFAULT_TIME_ZONE) {
    this.current = periodAt(this.now(), timeZone);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.schedule();
  }

  get period(): Period {
    return this.current;
  }

  get timeMode(): TimeMode {
    return this.mode;
  }

  onChange(fn: (p: Period) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setMode(mode: TimeMode): void {
    this.mode = mode;
    this.refresh();
  }

  /**
   * Dev/test hook: pretend the clock is `ms` ahead. With `refresh` false the
   * change is only noticed by the next timer or tab-visibility re-check.
   */
  setOffset(ms: number, refresh = true): void {
    this.offsetMs = ms;
    if (refresh) this.refresh();
  }

  /** Re-reads the clock (or pinned mode) and reschedules the next check. */
  refresh(): void {
    const next = this.mode === 'auto' ? periodAt(this.now(), this.timeZone) : this.mode;
    if (next !== this.current) {
      this.current = next;
      this.listeners.forEach((fn) => fn(next));
    }
    this.schedule();
  }

  destroy(): void {
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.listeners.clear();
  }

  private now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.mode !== 'auto') return;
    // +50ms so we land safely past the boundary.
    this.timer = setTimeout(() => this.refresh(), msUntilNextPeriod(this.now(), this.timeZone) + 50);
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible') this.refresh();
  };
}
