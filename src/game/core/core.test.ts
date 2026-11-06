import { describe, expect, it } from 'vitest';
import { ANCHOR_Y, AVATAR_FRAMES, avatarFrameRows, FRAME_H, FRAME_W } from '../art/avatarArt';
import { DEMO_ROOM, obstaclesOf } from '../room/roomData';
import { CollisionWorld } from './collision';
import { isBehind, sortByDepth, type DepthItem } from './depthSort';
import { keyboardDirToWorld, screenToWorld, worldToScreen } from './iso';
import { NavGrid } from './pathfinding';

const R = 0.22;

describe('iso projection', () => {
  it('round-trips world <-> screen', () => {
    for (const [x, y] of [[0, 0], [3.25, 1.5], [9, 8], [-2, 4.75]] as const) {
      const s = worldToScreen(x, y);
      const w = screenToWorld(s.x, s.y);
      expect(w.x).toBeCloseTo(x, 9);
      expect(w.y).toBeCloseTo(y, 9);
    }
  });

  it('maps keyboard directions to screen-consistent world directions', () => {
    const up = keyboardDirToWorld(0, -1);
    const s = worldToScreen(up.x, up.y);
    expect(s.x).toBeCloseTo(0);
    expect(s.y).toBeLessThan(0);
    // up + right walks exactly along the -y world axis (parallel to the right wall)
    const ur = keyboardDirToWorld(1, -1);
    expect(ur.x).toBeCloseTo(0);
    expect(ur.y).toBeCloseTo(-1);
    expect(Math.hypot(up.x, up.y)).toBeCloseTo(1);
  });
});

describe('collision', () => {
  const world = new CollisionWorld(9, 8, [{ x: 2, y: 2, w: 2, h: 1 }]);

  it('keeps bodies inside the room', () => {
    const p = world.move({ x: 1, y: 1 }, -5, -5, R);
    expect(p.x).toBeGreaterThanOrEqual(R - 1e-9);
    expect(p.y).toBeGreaterThanOrEqual(R - 1e-9);
    expect(world.isFree(p.x, p.y, R)).toBe(true);
  });

  it('never tunnels through furniture, even with a huge step', () => {
    const p = world.move({ x: 3, y: 1 }, 0, 10, R);
    expect(p.y).toBeLessThanOrEqual(2 - R + 1e-6);
    expect(world.isFree(p.x, p.y, R)).toBe(true);
  });

  it('slides along an obstacle instead of stopping', () => {
    // Moving diagonally into the top face of the box keeps the x motion.
    const p = world.move({ x: 2.5, y: 1.7 }, 0.5, 0.5, R);
    expect(p.x).toBeCloseTo(3, 5);
    expect(p.y).toBeLessThanOrEqual(2 - R + 1e-6);
  });
});

describe('collision corners (regression)', () => {
  // Bed and bookshelf form a corner pocket like in the demo room.
  const world = new CollisionWorld(9, 8, [
    { x: 0, y: 0.75, w: 3, h: 2 },
    { x: 3.25, y: 0, w: 1.5, h: 0.75 },
  ]);

  it('does not get stuck after being pushed into a corner', () => {
    let p = { x: 3.6, y: 1.6 };
    for (let i = 0; i < 120; i++) p = world.move(p, -0.03, -0.03, R); // walk into the pocket
    expect(world.isFree(p.x, p.y, R)).toBe(true);
    const before = p;
    for (let i = 0; i < 30; i++) p = world.move(p, 0.04, 0, R); // then walk along the shelf
    expect(p.x - before.x).toBeGreaterThan(1.1);
  });

  it('slides around a corner instead of stopping on it', () => {
    // Heading straight at the shelf's lower-left corner, slightly off-center.
    let p = { x: 3.2, y: 1.5 };
    for (let i = 0; i < 60; i++) p = world.move(p, 0.02, -0.03, R);
    expect(world.isFree(p.x, p.y, R)).toBe(true);
    expect(p.x).toBeGreaterThan(3.3);
  });
});

describe('pathfinding', () => {
  const world = new CollisionWorld(DEMO_ROOM.width, DEMO_ROOM.height, obstaclesOf(DEMO_ROOM));
  const nav = new NavGrid(world, R);

  it('finds a collision-free path around furniture', () => {
    const from = DEMO_ROOM.spawn;
    const to = { x: 0.6, y: 4.5 }; // behind the table, below the bed
    const path = nav.findPath(from, to);
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1];
    expect(last?.x).toBeCloseTo(to.x);
    expect(last?.y).toBeCloseTo(to.y);
    let prev = from;
    for (const p of path) {
      expect(world.isSegmentFree(prev, p, R)).toBe(true);
      prev = p;
    }
  });

  it('redirects clicks on furniture or outside the room to a reachable free spot', () => {
    for (const target of [{ x: 1.5, y: 1.5 } /* on the bed */, { x: 20, y: -5 } /* outside */]) {
      const path = nav.findPath(DEMO_ROOM.spawn, target);
      const last = path[path.length - 1];
      expect(last).toBeDefined();
      if (last) expect(world.isFree(last.x, last.y, R)).toBe(true);
    }
  });

  it('spawn point is free', () => {
    expect(world.isFree(DEMO_ROOM.spawn.x, DEMO_ROOM.spawn.y, R)).toBe(true);
  });
});

describe('depth sorting', () => {
  const item = (x: number, y: number, w: number, h: number): DepthItem => ({
    footprint: { x, y, w, h },
    bounds: [-1000, -1000, 1000, 1000], // force all pairs to be compared
  });

  it('draws a character behind a long bed when standing on its far side', () => {
    const bed = item(0, 1, 3, 2);
    const behindBed = item(1.3, 0.5, 0.4, 0.4); // y range ends before bed starts
    const inFront = item(1.3, 3.2, 0.4, 0.4);
    expect(isBehind(behindBed.footprint, bed.footprint)).toBe(true);
    expect(isBehind(bed.footprint, inFront.footprint)).toBe(true);
    const order = sortByDepth([inFront, bed, behindBed]);
    expect(order).toEqual([behindBed, bed, inFront]);
  });

  it('handles the case a single x+y sort key gets wrong', () => {
    // Long bed along x; a character beside its far end has a larger x+y than the
    // bed's center but is still behind it.
    const bed = item(0, 2, 6, 1);
    const ch = item(5, 1.4, 0.4, 0.4);
    const chCenter = 5.2 + 1.6;
    const bedCenter = 3 + 2.5;
    expect(chCenter).toBeGreaterThan(bedCenter);
    expect(sortByDepth([bed, ch])).toEqual([ch, bed]);
  });
});

describe('avatar sprite data', () => {
  it('every frame row is FRAME_W wide and feet sit on the anchor', () => {
    for (const frame of AVATAR_FRAMES) {
      const { rows, y } = avatarFrameRows(frame);
      for (const row of rows) expect(row, `${frame}: "${row}"`).toHaveLength(FRAME_W);
      // Feet always end exactly at the anchor line (walk bob lifts the body, not the feet).
      expect(y + rows.length, frame).toBe(ANCHOR_Y);
      expect(ANCHOR_Y).toBeLessThanOrEqual(FRAME_H);
    }
  });
});

describe('NavGrid main area', () => {
  it('is the largest connected floor area; tiny cut-off corners are outside it', () => {
    // A wall of furniture closes off the left 0.5 tiles of a 4 x 2 room.
    const world = new CollisionWorld(4, 2, [{ x: 0.5, y: 0, w: 0.5, h: 2 }]);
    const nav = new NavGrid(world, 0.1);
    const main = nav.mainArea();
    const corner = nav.cellOf({ x: 0.25, y: 1 });
    const open = nav.cellOf({ x: 3, y: 1 });
    expect(nav.isWalkable(corner.c, corner.r)).toBe(true); // walkable, but cut off
    expect(main.has(corner.r * nav.cols + corner.c)).toBe(false);
    expect(main.has(open.r * nav.cols + open.c)).toBe(true);
    // Someone left in the corner is sent to the nearest spot of the main area.
    const cell = nav.nearestWalkableCell({ x: 0.25, y: 1 }, main)!;
    expect(nav.cellCenter(cell.c, cell.r).x).toBeGreaterThan(1);
  });
});
