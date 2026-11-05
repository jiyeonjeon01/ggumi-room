/**
 * Isometric projection (2:1 pixel-art iso).
 *
 * World space: logical floor coordinates in tile units.
 *   +x runs toward the screen's lower-right, +y toward the lower-left.
 *   (0,0) is the back corner of the room. All movement/collision lives here.
 * Screen space: pixels in the Phaser world (before camera zoom).
 *   z (height above floor) is in screen pixels and only matters for rendering.
 */

export const TILE_W = 32;
export const TILE_H = 16;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

export interface Vec2 {
  x: number;
  y: number;
}

export function worldToScreen(x: number, y: number, z = 0): Vec2 {
  return { x: (x - y) * HALF_W, y: (x + y) * HALF_H - z };
}

/** Inverse of worldToScreen for points on the floor (z = 0). */
export function screenToWorld(sx: number, sy: number): Vec2 {
  const a = sx / HALF_W;
  const b = sy / HALF_H;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/**
 * Converts a keyboard direction (dx, dy in -1..1, screen-oriented: up = -dy)
 * to a normalized world direction. Single keys move toward the matching screen
 * direction ("up" = up on the monitor); two keys combine into a world axis, so
 * up+right walks exactly along the right-hand wall. Speed stays constant in
 * world units regardless of direction.
 */
export function keyboardDirToWorld(dx: number, dy: number): Vec2 {
  const x = dx + dy;
  const y = dy - dx;
  const len = Math.hypot(x, y);
  return len === 0 ? { x: 0, y: 0 } : { x: x / len, y: y / len };
}

/** Screen-space direction of a world velocity (used to pick facing). */
export function worldDirToScreen(vx: number, vy: number): Vec2 {
  return { x: (vx - vy) * HALF_W, y: (vx + vy) * HALF_H };
}
