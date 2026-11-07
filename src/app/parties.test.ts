import { describe, expect, it } from 'vitest';
import { clockOffset, formatRemaining, remainingMs } from './parties';

describe('party countdown', () => {
  it('follows the server clock, not the device clock', () => {
    // Device is 3 minutes behind the server.
    const device = Date.parse('2026-11-07T10:00:00Z');
    const offset = clockOffset('2026-11-07T10:03:00Z', device);
    expect(offset).toBe(180_000);
    // Closes 10 minutes after the server's "now": still 10 minutes left on this device.
    expect(remainingMs('2026-11-07T10:13:00Z', offset, device)).toBe(600_000);
    expect(remainingMs('2026-11-07T10:13:00Z', offset, device + 60_000)).toBe(540_000);
  });

  it('never goes negative and ignores a bad server time', () => {
    expect(remainingMs('2026-11-07T10:00:00Z', 0, Date.parse('2026-11-07T10:05:00Z'))).toBe(0);
    expect(clockOffset('nope', 123)).toBe(0);
  });

  it('reads minutes and seconds, rounding up', () => {
    expect(formatRemaining(30 * 60_000)).toBe('30분 0초');
    expect(formatRemaining(29 * 60_000 + 41_000)).toBe('29분 41초');
    expect(formatRemaining(44_100)).toBe('45초');
    expect(formatRemaining(1)).toBe('1초');
  });
});
