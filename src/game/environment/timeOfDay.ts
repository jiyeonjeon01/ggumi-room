/**
 * Real-world time -> time-of-day period. Fixed hour boundaries (no
 * sunrise/sunset API). Pure functions; the clock that drives them lives in
 * TimeOfDayClock.ts.
 */
export type Period = 'dawn' | 'day' | 'sunset' | 'night';

export const PERIODS: readonly Period[] = ['dawn', 'day', 'sunset', 'night'];

export const PERIOD_LABEL: Record<Period, string> = {
  dawn: '새벽',
  day: '낮',
  sunset: '노을',
  night: '밤',
};

export const DEFAULT_TIME_ZONE = 'Asia/Seoul';

/** Start hour of each period, in order through the day. */
const BOUNDARIES: readonly { hour: number; period: Period }[] = [
  { hour: 6, period: 'dawn' }, // 06:00–06:59
  { hour: 7, period: 'day' }, // 07:00–17:59
  { hour: 18, period: 'sunset' }, // 18:00–19:59
  { hour: 20, period: 'night' }, // 20:00–05:59
];

export function periodForHour(hour: number): Period {
  let period: Period = 'night';
  for (const b of BOUNDARIES) if (hour >= b.hour) period = b.period;
  return period;
}

/** Wall-clock time of day in a time zone (DST-safe via Intl). */
export function zonedTime(date: Date, timeZone: string): { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

export function periodAt(date: Date, timeZone = DEFAULT_TIME_ZONE): Period {
  return periodForHour(zonedTime(date, timeZone).hour);
}

/** Milliseconds from `date` until the next period boundary (always > 0). */
export function msUntilNextPeriod(date: Date, timeZone = DEFAULT_TIME_ZONE): number {
  const { hour, minute, second } = zonedTime(date, timeZone);
  const nowSec = hour * 3600 + minute * 60 + second;
  const next = BOUNDARIES.map((b) => b.hour * 3600).find((s) => s > nowSec) ?? 24 * 3600 + (BOUNDARIES[0]?.hour ?? 0) * 3600;
  return Math.max(1, (next - nowSec) * 1000 - date.getMilliseconds());
}
