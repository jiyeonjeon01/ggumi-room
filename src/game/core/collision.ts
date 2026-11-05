import type { Vec2 } from './iso';

/** Axis-aligned rectangle on the floor, in world (tile) units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Collision world for one room. Bodies are circles (characters); the room is
 * a rectangle [0,width]x[0,height]; obstacles are furniture footprints.
 * Everything here is in world units and independent of rendering.
 */
export class CollisionWorld {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly obstacles: readonly Rect[],
  ) {}

  /** True if a circle of `radius` at (x, y) touches no wall and no obstacle. */
  isFree(x: number, y: number, radius: number): boolean {
    if (x - radius < 0 || y - radius < 0 || x + radius > this.width || y + radius > this.height) {
      return false;
    }
    for (const o of this.obstacles) {
      if (circleIntersectsRect(x, y, radius, o)) return false;
    }
    return true;
  }

  /** True if a circle can travel in a straight line from a to b. */
  isSegmentFree(a: Vec2, b: Vec2, radius: number, step = 0.05): boolean {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.isFree(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius)) return false;
    }
    return true;
  }

  /**
   * Moves a circle by (dx, dy), sliding along walls and furniture instead of
   * stopping dead. Each sub-step moves freely and then pushes the circle back
   * out of anything it overlaps along the contact normal, which slides
   * smoothly along faces and around corners. Sub-steps are at most half the
   * radius long, so fast movement or long frames can never tunnel through.
   * Returns the new position; `pos` itself is not mutated.
   */
  move(pos: Vec2, dx: number, dy: number, radius: number): Vec2 {
    let x = pos.x;
    let y = pos.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (radius * 0.5)));
    for (let i = 0; i < steps; i++) {
      const next = this.resolve(x + dx / steps, y + dy / steps, radius);
      // Wedged between two obstacles closer than the body's diameter: stay put.
      if (!this.isFree(next.x, next.y, radius)) break;
      x = next.x;
      y = next.y;
    }
    return { x, y };
  }

  /** Pushes a circle out of walls and obstacles it overlaps. */
  private resolve(x: number, y: number, r: number): Vec2 {
    for (let iter = 0; iter < 4; iter++) {
      let pushed = false;
      for (const o of this.obstacles) {
        const cx = Math.max(o.x, Math.min(x, o.x + o.w));
        const cy = Math.max(o.y, Math.min(y, o.y + o.h));
        const ddx = x - cx;
        const ddy = y - cy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= r * r) continue;
        pushed = true;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          const k = (r + SKIN - d) / d;
          x += ddx * k;
          y += ddy * k;
        } else {
          // Center inside the rectangle: leave through the nearest side.
          const exits = [x - o.x, o.x + o.w - x, y - o.y, o.y + o.h - y];
          const m = Math.min(...exits);
          if (m === exits[0]) x = o.x - r - SKIN;
          else if (m === exits[1]) x = o.x + o.w + r + SKIN;
          else if (m === exits[2]) y = o.y - r - SKIN;
          else y = o.y + o.h + r + SKIN;
        }
      }
      const clampedX = Math.max(r + SKIN, Math.min(this.width - r - SKIN, x));
      const clampedY = Math.max(r + SKIN, Math.min(this.height - r - SKIN, y));
      if (clampedX !== x || clampedY !== y) pushed = true;
      x = clampedX;
      y = clampedY;
      if (!pushed) break;
    }
    return { x, y };
  }
}

/** Tiny separation kept after resolving contacts, so float error never reads as overlap. */
const SKIN = 1e-6;

export function circleIntersectsRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const ddx = cx - nx;
  const ddy = cy - ny;
  return ddx * ddx + ddy * ddy < r * r;
}
