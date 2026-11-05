import type { Rect } from './collision';

/** Anything drawn in the room's object layer (furniture, characters). */
export interface DepthItem {
  /** Floor footprint in world units. */
  footprint: Rect;
  /** Screen-space bounds of the drawn sprite: [left, top, right, bottom]. */
  bounds: readonly [number, number, number, number];
}

/**
 * True if `a` must be drawn before (behind) `b`.
 * For non-overlapping footprints this is exact: an object entirely on the -x
 * or -y side of another is further from the viewer. Footprints only overlap
 * for things like a character standing on a rug-like decal; then the object
 * whose center is nearer the front wins.
 */
export function isBehind(a: Rect, b: Rect): boolean {
  if (a.x + a.w <= b.x || a.y + a.h <= b.y) return true;
  if (b.x + b.w <= a.x || b.y + b.h <= a.y) return false;
  return a.x + a.w / 2 + a.y + a.h / 2 < b.x + b.w / 2 + b.y + b.h / 2;
}

function boundsOverlap(a: DepthItem['bounds'], b: DepthItem['bounds']): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/**
 * Orders items back-to-front with a topological sort over "is behind"
 * relations between items that actually overlap on screen. A single sort key
 * (like x + y) breaks for long furniture such as beds; this does not.
 * Cycles cannot occur for non-overlapping axis-aligned footprints; if bad data
 * ever produces one, the DFS simply breaks it instead of looping.
 */
export function sortByDepth<T extends DepthItem>(items: readonly T[]): T[] {
  const n = items.length;
  const behind: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = items[i];
      const b = items[j];
      if (!a || !b || !boundsOverlap(a.bounds, b.bounds)) continue;
      if (isBehind(a.footprint, b.footprint)) behind[j]?.push(i);
      else behind[i]?.push(j);
    }
  }

  const state = new Uint8Array(n); // 0 = new, 1 = visiting, 2 = done
  const out: T[] = [];
  const visit = (i: number) => {
    if (state[i] !== 0) return;
    state[i] = 1;
    for (const k of behind[i] ?? []) visit(k);
    state[i] = 2;
    const item = items[i];
    if (item) out.push(item);
  };
  for (let i = 0; i < n; i++) visit(i);
  return out;
}
