import { describe, expect, it } from 'vitest';
import { THEMES } from '../art/themes';
import { glassPointOf, leadInAt, mullions, projectToFloor, quantizeLight, windowLightAt } from '../art/sunlightArt';
import { DEMO_ROOM, type WindowPlacement } from '../room/roomData';
import { lookFor } from './look';
import { PERIODS } from './timeOfDay';

const win = DEMO_ROOM.windows[0]!;
const ray = lookFor('day', THEMES.pastel).sunlight.ray;

describe('window light', () => {
  it('projects the glass into a long, skewed, widening shape in front of its wall', () => {
    const near = projectToFloor(win, ray, win.u0, win.z0);
    expect(near).toEqual({ x: win.u0, y: ray.start }); // starts right under the window
    const farL = projectToFloor(win, ray, win.u0, win.z1);
    const farR = projectToFloor(win, ray, win.u1, win.z1);
    const nearR = projectToFloor(win, ray, win.u1, win.z0);
    expect(farL.y - near.y).toBeGreaterThan(win.u1 - win.u0); // longer than wide
    expect(farL.x).not.toBeCloseTo(near.x); // skewed, not a screen-aligned rectangle
    expect(farR.x - farL.x).toBeGreaterThan(nearR.x - near.x); // fans out
    const left: WindowPlacement = { ...win, wall: 'left' };
    expect(projectToFloor(left, ray, win.u0, win.z1)).toEqual({ x: farL.y, y: farL.x });
  });

  it('traces floor points back to the same glass point', () => {
    for (const [u, z] of [[win.u0 + 0.1, win.z0 + 3], [5.5, 60], [win.u1 - 0.05, win.z1 - 1]] as const) {
      const f = projectToFloor(win, ray, u, z);
      const g = glassPointOf(win, ray, f.x, f.y);
      expect(g.u).toBeCloseTo(u);
      expect(g.z).toBeCloseTo(z);
    }
  });

  it('connects the wall base to the pattern with a faint lead-in', () => {
    const mid = (win.u0 + win.u1) / 2 - 0.2;
    const atWall = leadInAt(win, ray, mid, 0.01);
    const atPatch = leadInAt(win, ray, mid, ray.start - 0.01);
    expect(atWall).toBeGreaterThan(0);
    expect(atPatch).toBeGreaterThan(atWall);
    expect(atPatch).toBeLessThan(0.5);
    expect(leadInAt(win, ray, win.u0 - 0.1, 0.1)).toBe(0);
  });

  it('shows four lit panes split by dimmer mullion shadows', () => {
    const { mid, sill } = mullions(win);
    const uq = [(win.u0 + mid) / 2, (mid + win.u1) / 2];
    const zq = [(win.z0 + sill) / 2, (sill + win.z1) / 2];
    const panes = uq.flatMap((u) => zq.map((z) => windowLightAt(win, ray, u, z)));
    // Light thins out deeper into the room, but every pane stays clearly lit.
    for (const v of panes) expect(quantizeLight(v, 0, 0)).toBeGreaterThanOrEqual(0.65);
    const bars = [windowLightAt(win, ray, mid, zq[0]!), windowLightAt(win, ray, uq[0]!, sill)];
    for (const v of bars) {
      expect(v).toBeGreaterThan(0); // a soft shadow, never black
      expect(quantizeLight(v, 0, 0)).toBeLessThan(quantizeLight(panes[0]!, 0, 0));
    }
    expect(windowLightAt(win, ray, win.u0 - 0.01, zq[0]!)).toBe(0);
    expect(windowLightAt(win, ray, uq[0]!, win.z1 + 1)).toBe(0);
  });

  it('fades out toward the edges of the patch', () => {
    const { sill } = mullions(win);
    const z = (win.z0 + sill) / 2;
    expect(windowLightAt(win, ray, win.u0 + 0.005, z)).toBeLessThan(0.2);
  });

  it('keeps one soft color and strength, but moves the light with the sun', () => {
    const { ray: _, ...ref } = lookFor('dawn', THEMES.pastel).sunlight;
    for (const theme of Object.values(THEMES)) {
      for (const p of PERIODS) {
        const { ray: __, ...v } = lookFor(p, theme).sunlight;
        expect(v).toEqual(ref);
      }
    }
    expect(ref.glass).toBeLessThanOrEqual(0.1);
    expect(ref.glow).toBeLessThanOrEqual(0.2);
    expect(ref.shaft).toBeLessThan(ref.floor); // the air is fainter than the floor
    const slant = (p: (typeof PERIODS)[number]) => lookFor(p, THEMES.pastel).sunlight.ray.slant;
    expect(slant('dawn')).toBeLessThan(0); // morning light falls one way…
    expect(slant('sunset')).toBeGreaterThan(0); // …evening light the other
    expect(new Set(PERIODS.map((p) => JSON.stringify(lookFor(p, THEMES.pastel).sunlight.ray))).size).toBe(4);
  });

  it('lights the monitor at night and barely by day', () => {
    expect(lookFor('night', THEMES.pastel).screen).toBe(1);
    expect(lookFor('day', THEMES.pastel).screen).toBeLessThan(0.1);
  });
});
