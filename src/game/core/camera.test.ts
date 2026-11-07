import { describe, expect, it } from 'vitest';
import { centreRange, DEADZONE, fitZoom, followAxis, followZoom, roomExtent } from './camera';

describe('fit camera (personal rooms)', () => {
  it('uses the largest whole zoom that fits, a fraction on tiny screens', () => {
    const e = roomExtent(9, 8);
    expect(fitZoom(836, 660, e)).toBe(2);
    expect(fitZoom(1600, 1000, e)).toBe(4);
    expect(fitZoom(300, 300, e)).toBeLessThan(1);
  });
});

describe('follow camera (party lounge)', () => {
  it('matches the personal room zoom on the same screen', () => {
    for (const [w, h] of [
      [836, 660],
      [1600, 1000],
    ] as const)
      expect(followZoom(w, h)).toBe(fitZoom(w, h, roomExtent(9, 8)));
  });

  it('never shrinks to a fraction on phones, nor zooms into a sliver', () => {
    expect(followZoom(358, 560)).toBe(2); // phone portrait
    expect(followZoom(600, 220)).toBe(1); // short landscape phone: whole number, 220px tall
    expect(followZoom(600, 300)).toBe(2);
  });

  it('keeps the view inside the room, centred when the room is smaller', () => {
    expect(centreRange(-200, 200, 100)).toEqual([-162, 162]);
    expect(centreRange(-200, 200, 500)).toEqual([0, 0]);
  });

  it('holds still inside the dead zone, then follows smoothly and stops at the edge', () => {
    const view = 400;
    const range: [number, number] = [-1000, 1000];
    expect(followAxis(0, (view * DEADZONE) / 2 - 1, view, range, 1 / 60)).toBe(0);
    const step = followAxis(0, 300, view, range, 1 / 60);
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(300 - 40); // eases, doesn't jump
    let c = 0;
    for (let i = 0; i < 240; i++) c = followAxis(c, 300, view, range, 1 / 60);
    expect(c).toBe(300 - 40); // character rests at the dead zone's edge
    expect(followAxis(0, 5000, view, range, 0)).toBe(1000); // snap, clamped to the room
  });
});
