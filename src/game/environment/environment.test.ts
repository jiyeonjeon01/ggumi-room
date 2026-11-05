import { describe, expect, it } from 'vitest';
import { THEMES } from '../art/themes';
import { CLOUD_SPRITES, cloudSpan, composeScenery, glassGeometry } from '../art/windowArt';
import { DEMO_ROOM, type WindowPlacement } from '../room/roomData';
import { lookFor } from './look';
import { msUntilNextPeriod, periodAt, periodForHour, PERIODS } from './timeOfDay';

const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.length === b.length && a.every((v, i) => v === b[i]);

describe('time of day', () => {
  it('maps hours to periods at the exact boundaries', () => {
    const expected = [
      'night', 'night', 'night', 'night', 'night', 'night', // 0–5
      'dawn', // 6
      'day', 'day', 'day', 'day', 'day', 'day', 'day', 'day', 'day', 'day', 'day', // 7–17
      'sunset', 'sunset', // 18–19
      'night', 'night', 'night', 'night', // 20–23
    ];
    expect(Array.from({ length: 24 }, (_, h) => periodForHour(h))).toEqual(expected);
  });

  it('uses Asia/Seoul regardless of the machine time zone', () => {
    // KST = UTC+9
    expect(periodAt(new Date('2026-11-05T21:30:00Z'))).toBe('dawn'); // 06:30
    expect(periodAt(new Date('2026-11-05T08:59:59Z'))).toBe('day'); // 17:59:59
    expect(periodAt(new Date('2026-11-05T09:00:00Z'))).toBe('sunset'); // 18:00
    expect(periodAt(new Date('2026-11-05T11:00:00Z'))).toBe('night'); // 20:00
    expect(periodAt(new Date('2026-11-05T20:59:59Z'))).toBe('night'); // 05:59:59
  });

  it('computes the delay to the next boundary', () => {
    expect(msUntilNextPeriod(new Date('2026-11-05T08:59:30.250Z'))).toBe(29_750); // 17:59:30.25 → 18:00
    expect(msUntilNextPeriod(new Date('2026-11-05T13:00:00Z'))).toBe(8 * 3600_000); // 22:00 → 06:00
    expect(msUntilNextPeriod(new Date('2026-11-05T22:00:00Z'))).toBe(11 * 3600_000); // 07:00 → 18:00
  });
});

describe('theme environment overrides', () => {
  it('lets a theme tweak the shared look without its own window system', () => {
    expect(lookFor('night', THEMES.galaxy).ambient).not.toBe(lookFor('night', THEMES.pastel).ambient);
    expect(lookFor('night', THEMES.galaxy).sky).toEqual(lookFor('night', THEMES.pastel).sky);
  });
});

describe('window scenery', () => {
  const windows: WindowPlacement[] = [
    ...DEMO_ROOM.windows,
    { wall: 'left', u0: 2, u1: 3.5, z0: 30, z1: 70 }, // other wall, other size
  ];

  for (const win of windows) {
    const g = glassGeometry(win);

    it(`never draws outside the glass and always fills it (${win.wall} wall)`, () => {
      for (const period of PERIODS) {
        const look = lookFor(period, THEMES.pastel);
        for (let off = 0; off < cloudSpan(g, 0) + 2; off += 3) {
          const pc = composeScenery(g, look, { clouds: [off, off * 2], stars: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3] });
          for (let i = 0; i < g.width * g.height; i++) {
            const opaque = (pc.data[i * 4 + 3] ?? 0) > 0;
            expect(opaque, `${period} pixel ${i}`).toBe(g.mask[i] === 1);
          }
        }
      }
    });

    it(`hides clouds while they wrap around (${win.wall} wall)`, () => {
      const look = lookFor('day', THEMES.pastel);
      const empty = composeScenery(g, { ...look, cloudCount: 0 }, { clouds: [], stars: [] }).data;
      for (const [i, span] of [[0, cloudSpan(g, 0)], [1, cloudSpan(g, 1)]] as const) {
        const clouds = (o: number) => (i === 0 ? [o, 0] : [0, o]); // offset 0 = parked off-glass
        // Just before and just after the wrap point the cloud is fully off-glass.
        for (const o of [span - 1, span, 0]) {
          const data = composeScenery(g, { ...look, cloudCount: 2 }, { clouds: clouds(o), stars: [] }).data;
          expect(same(data, empty), `cloud ${i} offset ${o}`).toBe(true);
        }
        // Mid-way it is visible.
        const mid = composeScenery(g, { ...look, cloudCount: 2 }, { clouds: clouds(Math.floor(span / 2)), stars: [] }).data;
        expect(same(mid, empty)).toBe(false);
      }
    });
  }

  it('places stars inside the glass and twinkle levels change pixels', () => {
    const g = glassGeometry(DEMO_ROOM.windows[0]!);
    expect(g.stars.length).toBeGreaterThanOrEqual(8);
    for (const s of g.stars) expect(g.mask[s.y * g.width + s.x]).toBe(1);
    const look = lookFor('night', THEMES.pastel);
    const dim = composeScenery(g, look, { clouds: [], stars: [0, 0, 0, 0, 0, 0, 0, 0] }).data;
    const bright = composeScenery(g, look, { clouds: [], stars: [3, 3, 3, 3, 3, 3, 3, 3] }).data;
    expect(same(dim, bright)).toBe(false);
  });

  it('cloud sprites are rectangular', () => {
    for (const rows of CLOUD_SPRITES) for (const r of rows) expect(r).toHaveLength(rows[0]?.length ?? 0);
  });
});
