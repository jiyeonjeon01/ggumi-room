import { PixelCanvas } from './pixelCanvas';
import type { LayerArt } from './roomArt';

/**
 * Light cast by indoor sources onto real surfaces (a wall, a desk top), so
 * it sits in the room's space instead of floating as a screen-space blob.
 * Same pixel-art language as the window light: a few stepped alpha levels
 * with a checkered fringe. All layers anchor at world (0, 0, 0).
 */

const HW = 16;
const HH = 8;

/** Stepped falloff for a 0..1 distance (1 = edge). */
function ring(d: number, x: number, y: number): number {
  if (d <= 0.35) return 150;
  if (d <= 0.65) return 95;
  if (d <= 1) return (x + y) % 2 ? 55 : 25;
  return 0;
}

/** Pixel canvas covering the given screen-space points (world pixels). */
function canvasAround(xs: number[], ys: number[]): PixelCanvas {
  const left = Math.floor(Math.min(...xs)) - 1;
  const top = Math.floor(Math.min(...ys)) - 1;
  return new PixelCanvas(Math.ceil(Math.max(...xs)) + 2 - left, Math.ceil(Math.max(...ys)) + 2 - top, -left, -top);
}

/**
 * Glow on a back wall around a lamp standing in front of it: an ellipse on
 * the wall plane centered at the lamp's height, wider than tall. `u` is the
 * lamp's position along the wall (y for the left wall, x for the right one),
 * `z` its height in pixels; `ru` (tiles) and `rz` (pixels) are the radii.
 */
export function drawWallGlow(wall: 'left' | 'right', u: number, z: number, color: number, ru = 1.3, rz = 24): LayerArt {
  const us = [u - ru, u + ru];
  const xs = us.map((v) => (wall === 'right' ? v : -v) * HW);
  const ys = us.flatMap((v) => [v * HH - z - rz, v * HH - z + rz]);
  const pc = canvasAround(xs, ys);
  for (let py = 0; py < pc.height; py++) {
    for (let px = 0; px < pc.width; px++) {
      const sx = (px + 0.5 - pc.ox) / HW;
      const pu = wall === 'right' ? sx : -sx;
      const pz = pu * HH - (py + 0.5 - pc.oy);
      if (pu < 0 || pz < 0) continue; // only on the wall, above the floor
      const a = ring(Math.hypot((pu - u) / ru, (pz - z) / rz), px, py);
      if (a) pc.set(px, py, color, a);
    }
  }
  return { canvas: pc.toCanvas(), anchorX: pc.ox, anchorY: pc.oy };
}

/** A screen facing +y: the glass on the plane y = `y`, spanning x0..x1, z0..z1 (pixels). */
export interface ScreenPlacement {
  x0: number;
  x1: number;
  y: number;
  z0: number;
  z1: number;
  /** Height of the surface in front of the screen (desk top), and how far it reaches (tiles). */
  surfaceZ: number;
  surfaceDepth: number;
}

/**
 * Light of a screen: the screen face itself glowing, and a soft fan of light
 * on the desk top in front of it that widens and fades away from the screen.
 * Nothing on the floor; a monitor is too dim to light the room.
 */
export function drawScreenLight(s: ScreenPlacement, color: number): LayerArt {
  const far = s.y + s.surfaceDepth;
  const spread = 0.25;
  const corners = [
    [s.x0, s.y, s.z1],
    [s.x1, s.y, s.z1],
    [s.x0 - spread, far, s.surfaceZ],
    [s.x1 + spread, far, s.surfaceZ],
  ] as const;
  const pc = canvasAround(
    corners.map(([x, y]) => (x - y) * HW),
    corners.map(([x, y, z]) => (x + y) * HH - z),
  );
  for (let py = 0; py < pc.height; py++) {
    for (let px = 0; px < pc.width; px++) {
      const sx = (px + 0.5 - pc.ox) / HW;
      // Screen face: plane y = s.y.
      const fx = sx + s.y;
      const fz = (fx + s.y) * HH - (py + 0.5 - pc.oy);
      if (fx >= s.x0 && fx <= s.x1 && fz >= s.z0 && fz <= s.z1) {
        pc.set(px, py, color, 200);
        continue;
      }
      // Desk top: horizontal plane at surfaceZ.
      const sy = (py + 0.5 - pc.oy + s.surfaceZ) / HH;
      const X = (sx + sy) / 2;
      const Y = (sy - sx) / 2;
      const t = (Y - s.y) / s.surfaceDepth;
      if (t < 0 || t > 1) continue;
      const w = spread * t;
      if (X < s.x0 - w || X > s.x1 + w) continue;
      const side = Math.min(1, Math.min(X - (s.x0 - w), s.x1 + w - X) / 0.15);
      const v = (1 - t) * side;
      const a = v > 0.6 ? 150 : v > 0.3 ? 95 : v > 0.08 ? ((px + py) % 2 ? 55 : 0) : 0;
      if (a) pc.set(px, py, color, a);
    }
  }
  return { canvas: pc.toCanvas(), anchorX: pc.ox, anchorY: pc.oy };
}
