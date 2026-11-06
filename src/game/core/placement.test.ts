import { describe, expect, it } from 'vitest';
import cases from '../../../shared/layout-cases.json';
import { LayoutEditor } from './layoutEditor';
import {
  DEFAULT_LAYOUT,
  findSpot,
  footprint,
  FURNITURE_TYPES,
  nextFacing,
  rotationOf,
  MAX_ITEMS,
  pathsConnected,
  size,
  validateLayout,
  type LayoutItem,
} from './placement';

function caseItems(spec: unknown): { type: string; x: number; y: number; facing: number }[] {
  if (spec === 'default') return [...DEFAULT_LAYOUT];
  if (typeof spec === 'string' && spec.startsWith('many:')) {
    return Array.from({ length: Number(spec.slice(5)) }, () => ({ type: 'cushion', x: 0, y: 0, facing: 0 }));
  }
  return spec as { type: string; x: number; y: number; facing: number }[];
}

describe('shared layout cases (same file as the API tests)', () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(validateLayout(caseItems(c.items))?.code ?? null).toBe(c.error);
    });
  }
});

describe('placement rules', () => {
  it('facing 1 swaps the footprint', () => {
    expect(size('desk', 0)).toEqual({ w: 2, h: 1 });
    expect(size('desk', 1)).toEqual({ w: 1, h: 2 });
    expect(footprint({ type: 'bed', x: 1, y: 2, facing: 1 })).toEqual({ x: 1, y: 2, w: 2, h: 3 });
  });

  it('the default layout is valid and leaves the spawn point free', () => {
    expect(validateLayout(DEFAULT_LAYOUT, { x: 7, y: 5.5 })).toBeNull();
  });

  it('an empty room is one connected area; a full-width wall is not', () => {
    expect(pathsConnected([])).toBe(true);
    expect(pathsConnected([{ x: 0, y: 4, w: 9, h: 0.5 }])).toBe(false);
  });

  it('keeps furniture off the player', () => {
    expect(validateLayout([{ type: 'chair', x: 2, y: 2, facing: 0 }], { x: 2.3, y: 2.3 })?.code).toBe('on_player');
    expect(validateLayout([{ type: 'rug', x: 2, y: 2, facing: 0 }], { x: 2.3, y: 2.3 })).toBeNull(); // rugs are fine
  });

  it('has the 15 catalog pieces, all addable, turnable and back again', () => {
    expect(FURNITURE_TYPES).toHaveLength(15);
    for (const type of ['sofa', 'vanity', 'wardrobe', 'round_table', 'beanbag', 'mirror'] as const) {
      expect(FURNITURE_TYPES).toContain(type);
      const e = new LayoutEditor([], { x: 7, y: 5.5 }); // empty room: nothing in the way of turning
      expect(e.add(type).ok).toBe(true);
      const uid = e.selected!.uid;
      const order = rotationOf(type); // the sofa turns four ways, the others two
      for (const want of [...order.slice(1), order[0]]) {
        expect(e.rotate(uid).ok).toBe(true);
        expect(e.selected?.facing).toBe(want);
      }
      expect(validateLayout(e.layout())).toBeNull();
    }
  });

  it('bed, chair and sofa turn four ways and come back; the rest keep two facings', () => {
    for (const type of ['bed', 'chair', 'sofa'] as const) {
      const e = new LayoutEditor([], { x: 7, y: 5.5 });
      expect(e.add(type).ok).toBe(true);
      const uid = e.selected!.uid;
      const seen = [e.selected!.facing];
      for (let i = 0; i < 4; i++) {
        expect(e.rotate(uid).ok).toBe(true);
        seen.push(e.selected!.facing);
      }
      expect(new Set(seen.slice(0, 4)).size).toBe(4); // four different facings
      expect(seen[4]).toBe(seen[0]); // a full turn later: back where it started
      expect(seen.slice(0, 4)).toEqual([...rotationOf(type)]);
      // Quarter turns swap the footprint, half turns keep it.
      expect(size(type, 1)).toEqual(size(type, 3));
      expect(size(type, 0)).toEqual(size(type, 2));
      e.undo();
      expect(e.selected?.facing ?? e.items.find((i) => i.uid === uid)?.facing).toBe(seen[3]); // undo steps back one turn
    }
    for (const type of FURNITURE_TYPES.filter((t) => !['bed', 'chair', 'sofa'].includes(t))) {
      expect(rotationOf(type)).toEqual([0, 1]);
      expect(nextFacing(type, 1)).toBe(0);
    }
  });

  it('finds a free spot for a new piece, or none when the room is full', () => {
    const spot = findSpot(DEFAULT_LAYOUT, 'chair', 0);
    expect(spot).not.toBeNull();
    expect(validateLayout([...DEFAULT_LAYOUT, spot as LayoutItem])).toBeNull();
    expect(MAX_ITEMS).toBe(40);
  });
});

describe('LayoutEditor', () => {
  const start = () => new LayoutEditor(DEFAULT_LAYOUT, { x: 7, y: 5.5 });
  const uidOf = (e: LayoutEditor, type: string) => e.items.find((i) => i.type === type)?.uid as string;

  it('moves, rotates, adds and removes only in the draft; cancel restores', () => {
    const e = start();
    expect(e.dirty).toBe(false);
    const table = uidOf(e, 'table');
    expect(e.move(table, 2.5, 4.5).ok).toBe(true);
    expect(e.rotate(uidOf(e, 'desk')).ok).toBe(true);
    expect(e.add('chair').ok).toBe(true);
    expect(e.selected?.type).toBe('chair');
    expect(e.remove(uidOf(e, 'cushion')).ok).toBe(true);
    expect(e.dirty).toBe(true);
    expect(e.items).toHaveLength(DEFAULT_LAYOUT.length); // +chair -cushion
    e.cancel();
    expect(e.dirty).toBe(false);
    expect(e.layout()).toEqual(DEFAULT_LAYOUT);
  });

  it('undo steps back one change at a time', () => {
    const e = start();
    const table = uidOf(e, 'table');
    e.move(table, 2.5, 4.5);
    e.nudge(table, 1, 0);
    expect(e.items.find((i) => i.uid === table)).toMatchObject({ x: 2.75, y: 4.5 });
    e.undo();
    expect(e.items.find((i) => i.uid === table)).toMatchObject({ x: 2.5, y: 4.5 });
    e.undo();
    expect(e.dirty).toBe(false);
    expect(e.canUndo).toBe(false);
  });

  it('refuses changes that would make the layout invalid', () => {
    const e = start();
    const table = uidOf(e, 'table');
    const r = e.move(table, 0, 1); // onto the bed
    expect(r).toEqual({ ok: false, error: { code: 'overlap', index: expect.any(Number) } });
    expect(e.move(table, 8.5, 0).ok).toBe(false); // out of the room
    expect(e.dirty).toBe(false);
    expect(e.check(table, 6.75, 5.25)?.code).toBe('on_player'); // the character stands at (7, 5.5)
  });

  it('snaps to the grid and keeps rotated pieces inside the room', () => {
    const e = start();
    const desk = uidOf(e, 'desk'); // against the right wall at (6.25, 0), 2x1
    e.move(desk, 6.3, 2.1);
    expect(e.items.find((i) => i.uid === desk)).toMatchObject({ x: 6.25, y: 2 });
    expect(e.rotate(desk).ok).toBe(true);
    const d = e.items.find((i) => i.uid === desk) as LayoutItem;
    const f = footprint(d);
    expect(f.x + f.w).toBeLessThanOrEqual(9);
    expect(d.facing).toBe(1);
  });

  it('notifies subscribers', () => {
    const e = start();
    let calls = 0;
    e.subscribe(() => calls++);
    e.select(uidOf(e, 'bed'));
    e.nudge(uidOf(e, 'table'), 0, -1);
    e.undo();
    expect(calls).toBe(3);
  });
});
