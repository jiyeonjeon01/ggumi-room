import type { CollisionWorld } from './collision';
import type { Vec2 } from './iso';

/**
 * Walkability grid derived from a CollisionWorld for one body radius.
 * A cell is walkable when a body centered on it collides with nothing, so the
 * grid already accounts for character size ("inflated" obstacles).
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly walkable: Uint8Array;

  constructor(
    readonly world: CollisionWorld,
    readonly radius: number,
    readonly cellSize = 0.25,
  ) {
    this.cols = Math.round(world.width / cellSize);
    this.rows = Math.round(world.height / cellSize);
    this.walkable = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const p = this.cellCenter(c, r);
        this.walkable[r * this.cols + c] = world.isFree(p.x, p.y, radius) ? 1 : 0;
      }
    }
  }

  cellCenter(c: number, r: number): Vec2 {
    return { x: (c + 0.5) * this.cellSize, y: (r + 0.5) * this.cellSize };
  }

  isWalkable(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.walkable[r * this.cols + c] === 1;
  }

  /** Nearest walkable cell to a world point (by straight-line distance). */
  nearestWalkableCell(p: Vec2): { c: number; r: number } | null {
    let best: { c: number; r: number } | null = null;
    let bestD = Infinity;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.isWalkable(c, r)) continue;
        const q = this.cellCenter(c, r);
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { c, r };
        }
      }
    }
    return best;
  }

  /**
   * Finds a path from `from` toward `to`. If `to` is blocked (e.g. the player
   * clicked on a bed or outside the room) the path ends at the closest
   * reachable free spot instead. Returns waypoints excluding `from`, already
   * smoothed so the character walks in straight lines where possible.
   * Returns an empty array when no movement is needed or possible.
   */
  findPath(from: Vec2, to: Vec2): Vec2[] {
    const { world, radius } = this;
    const goalPoint = world.isFree(to.x, to.y, radius) ? to : null;
    const goalCell = this.nearestWalkableCell(to);
    const startCell = this.nearestWalkableCell(from);
    if (!goalCell || !startCell) return [];

    // Direct line: no search needed.
    const target = goalPoint ?? this.cellCenter(goalCell.c, goalCell.r);
    if (world.isSegmentFree(from, target, radius)) {
      return Math.hypot(target.x - from.x, target.y - from.y) < 1e-3 ? [] : [target];
    }

    const cells = this.astar(startCell, goalCell);
    if (!cells) return [];

    const raw: Vec2[] = cells.map(({ c, r }) => this.cellCenter(c, r));
    if (goalPoint && world.isSegmentFree(raw[raw.length - 1] ?? from, goalPoint, radius)) {
      raw[raw.length - 1] = goalPoint;
    }
    return this.smooth(from, raw);
  }

  /** String-pulling: drop waypoints that can be skipped by a straight walk. */
  private smooth(from: Vec2, points: Vec2[]): Vec2[] {
    const out: Vec2[] = [];
    let anchor = from;
    let i = 0;
    while (i < points.length) {
      let far = i;
      for (let j = points.length - 1; j > i; j--) {
        const pj = points[j];
        if (pj && this.world.isSegmentFree(anchor, pj, this.radius)) {
          far = j;
          break;
        }
      }
      const p = points[far];
      if (!p) break;
      out.push(p);
      anchor = p;
      i = far + 1;
    }
    return out;
  }

  /** 8-directional A* without corner cutting. Returns cells from start to goal. */
  private astar(
    start: { c: number; r: number },
    goal: { c: number; r: number },
  ): { c: number; r: number }[] | null {
    const { cols } = this;
    const total = cols * this.rows;
    const g = new Float64Array(total).fill(Infinity);
    const parent = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const startIdx = start.r * cols + start.c;
    const goalIdx = goal.r * cols + goal.c;
    const heap = new MinHeap();

    const h = (c: number, r: number) => {
      const dx = Math.abs(c - goal.c);
      const dy = Math.abs(r - goal.r);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };

    g[startIdx] = 0;
    heap.push(startIdx, h(start.c, start.r));
    // If the goal is in an unreachable pocket, walk to the closest reachable cell.
    let bestIdx = startIdx;
    let bestH = h(start.c, start.r);

    while (heap.size > 0) {
      const idx = heap.pop();
      if (idx === goalIdx) {
        bestIdx = goalIdx;
        break;
      }
      if (closed[idx]) continue;
      closed[idx] = 1;
      const c = idx % cols;
      const r = (idx - c) / cols;
      const gi = g[idx] ?? Infinity;
      const hi = h(c, r);
      if (hi < bestH) {
        bestH = hi;
        bestIdx = idx;
      }

      for (const [dc, dr] of NEIGHBORS) {
        const nc = c + dc;
        const nr = r + dr;
        if (!this.isWalkable(nc, nr)) continue;
        // No corner cutting: both orthogonal neighbours must be open.
        if (dc !== 0 && dr !== 0 && (!this.isWalkable(c + dc, r) || !this.isWalkable(c, r + dr))) continue;
        const nIdx = nr * cols + nc;
        const ng = gi + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
        if (ng < (g[nIdx] ?? Infinity)) {
          g[nIdx] = ng;
          parent[nIdx] = idx;
          heap.push(nIdx, ng + h(nc, nr));
        }
      }
    }

    if (bestIdx === startIdx && startIdx !== goalIdx) return null;
    const path: { c: number; r: number }[] = [];
    for (let i = bestIdx; i !== -1 && i !== startIdx; i = parent[i] ?? -1) {
      path.push({ c: i % cols, r: Math.floor(i / cols) });
    }
    return path.reverse();
  }
}

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Minimal binary heap of (id, priority). */
class MinHeap {
  private ids: number[] = [];
  private prio: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, p: number): void {
    const { ids, prio } = this;
    let i = ids.length;
    ids.push(id);
    prio.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((prio[parent] ?? 0) <= p) break;
      ids[i] = ids[parent] ?? 0;
      prio[i] = prio[parent] ?? 0;
      i = parent;
    }
    ids[i] = id;
    prio[i] = p;
  }

  pop(): number {
    const { ids, prio } = this;
    const top = ids[0] ?? -1;
    const lastId = ids.pop() ?? 0;
    const lastP = prio.pop() ?? 0;
    const n = ids.length;
    if (n === 0) return top;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const child = r < n && (prio[r] ?? 0) < (prio[l] ?? 0) ? r : l;
      if ((prio[child] ?? 0) >= lastP) break;
      ids[i] = ids[child] ?? 0;
      prio[i] = prio[child] ?? 0;
      i = child;
    }
    ids[i] = lastId;
    prio[i] = lastP;
    return top;
  }
}
