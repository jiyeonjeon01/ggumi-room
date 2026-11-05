import { screenToWorld } from '../core/iso';
import type { WindowPlacement } from '../room/roomData';
import { mix, PixelCanvas } from './pixelCanvas';
import type { LayerArt } from './roomArt';
import { wallRectBounds, type GlassGeometry } from './windowArt';

/**
 * Natural light through a window, as pre-rendered pixel-art layers:
 *  - a faint sheen on the glass (the window is a bright opening, not a lamp);
 *  - a faint glow on the wall around the frame;
 *  - the light in the air from the glass down to the floor (drawLightShaft);
 *  - the window's light on the floor: a short lead-in from the wall base
 *    under the window, then the 2x2 mullion pattern stretched into the room.
 *
 * The floor light is a projection: every floor pixel is traced back to the
 * glass through the ray model below and lit only if it lands on glass, so it
 * lies flat on the iso floor and follows the window's position and size.
 * The model is stylized rather than physical: the glass bottom lands
 * `start` tiles from the wall (so the light visibly begins under the window
 * instead of floating two tiles away), the glass height stretches over the
 * floor, slides along the wall and fans out toward the far end, which gives
 * the long, skewed, slightly widening shape of real window light.
 */

/** How the glass maps onto the floor (tiles; z in wall pixels above the sill). */
export interface SunRay {
  /** Distance from the wall where the bottom of the glass lands. */
  start: number;
  /** Floor travel into the room per pixel of glass height. Larger = lower sun, longer patch. */
  reach: number;
  /** Sideways travel along the wall per pixel of glass height (skew; + = toward +u). */
  slant: number;
  /** How much wider the far end is than the near end (0.3 = 30% wider). */
  spread: number;
}

/** Fraction of the patch width over which light fades out at the sides. */
export const EDGE_FADE = 0.15;
/** Far end fades over this fraction of the length (light thins out deeper in). */
const FAR_FADE = 0.25;
/** Near end ramps up over this fraction, continuing the lead-in. */
const NEAR_RAMP = 0.12;
/** Mullion shadows keep this much of the surrounding light. */
export const MULLION_LIGHT = 0.3;
/** Half width of a mullion's shadow on the floor (tiles), and of its soft edge. */
const BAR = 0.07;
const PENUMBRA = 0.05;
/** Far end of the patch keeps this much light (it is further from the glass). */
const FAR_LIGHT = 0.75;
/** Lead-in strength at the wall base and where it meets the patch. */
const LEAD = [0.14, 0.4] as const;

/** Where a mullion / transom sits on the glass, matching drawWindowFrame. */
export function mullions(win: WindowPlacement) {
  return { mid: (win.u0 + win.u1) / 2, sill: win.z0 + Math.round((win.z1 - win.z0) * 0.47) + 1 };
}

const toFloor = (win: WindowPlacement, along: number, into: number) =>
  win.wall === 'right' ? { x: along, y: into } : { x: into, y: along };

/** Floor point (world tiles) lit through the glass point (u, z) of a window. */
export function projectToFloor(win: WindowPlacement, ray: SunRay, u: number, z: number) {
  const h = z - win.z0;
  const t = h / (win.z1 - win.z0);
  const { mid } = mullions(win);
  return toFloor(win, mid + (u - mid) * (1 + ray.spread * t) + ray.slant * h, ray.start + ray.reach * h);
}

/** Inverse of projectToFloor: glass point behind a floor point (along/into the wall). */
export function glassPointOf(win: WindowPlacement, ray: SunRay, along: number, into: number) {
  const h = (into - ray.start) / ray.reach;
  const t = h / (win.z1 - win.z0);
  const { mid } = mullions(win);
  return { u: mid + (along - mid - ray.slant * h) / (1 + ray.spread * t), z: win.z0 + h };
}

/**
 * Pixel-art light levels: a flat core, two solid steps and a checkerboard
 * fringe. Few distinct values keep the pattern crisp instead of noisy.
 */
export function quantizeLight(v: number, x: number, y: number): number {
  if (v >= 0.85) return 1;
  if (v >= 0.55) return 0.65;
  if (v >= 0.25) return 0.3;
  if (v >= 0.1) return (x + y) % 2 ? 0.3 : 0;
  return 0;
}

/** Linear 0..1 ramp over the outer EDGE_FADE of a 0..1 coordinate. */
const edge = (s: number) => Math.min(1, Math.min(s, 1 - s) / EDGE_FADE);

/**
 * Light intensity (0..1, before quantizing) on the floor where the glass point
 * (u, z) lands. Mullion shadows are sized in floor tiles so they stay readable
 * (a 2px bar on the wall would shrink to under a pixel on the floor).
 */
export function windowLightAt(win: WindowPlacement, ray: SunRay, u: number, z: number): number {
  const s = (u - win.u0) / (win.u1 - win.u0);
  const t = (z - win.z0) / (win.z1 - win.z0);
  if (s < 0 || s > 1 || t < 0 || t > 1) return 0;
  const near = Math.min(1, LEAD[1] + ((1 - LEAD[1]) * t) / NEAR_RAMP);
  const far = Math.min(1, (1 - t) / FAR_FADE);
  let v = edge(s) * near * far * (1 - (1 - FAR_LIGHT) * t);
  const { mid, sill } = mullions(win);
  const bar = (d: number) => (d <= BAR ? 0 : d <= BAR + PENUMBRA ? 0.5 : 1);
  v *= MULLION_LIGHT + (1 - MULLION_LIGHT) * Math.min(bar(Math.abs(u - mid)), bar(Math.abs(z - sill) * ray.reach));
  return v;
}

/** Faint strip from the wall base under the window to the start of the patch. */
export function leadInAt(win: WindowPlacement, ray: SunRay, along: number, into: number): number {
  if (into < 0 || into >= ray.start) return 0;
  const s = (along - win.u0) / (win.u1 - win.u0);
  if (s < 0 || s > 1) return 0;
  return edge(s) * (LEAD[0] + ((LEAD[1] - LEAD[0]) * into) / ray.start);
}

/** The window's light on the floor (lead-in + patch), clipped to the room. */
export function drawFloorLight(
  win: WindowPlacement,
  ray: SunRay,
  room: { width: number; height: number },
  color: number,
): LayerArt {
  const corners = [win.u0, win.u1].flatMap((u) => [
    toFloor(win, u, 0),
    ...[win.z0, win.z1].map((z) => projectToFloor(win, ray, u, z)),
  ]);
  const sxs = corners.map((c) => (c.x - c.y) * 16);
  const sys = corners.map((c) => (c.x + c.y) * 8);
  const left = Math.floor(Math.min(...sxs)) - 1;
  const top = Math.floor(Math.min(...sys)) - 1;
  const pc = new PixelCanvas(Math.ceil(Math.max(...sxs)) + 1 - left, Math.ceil(Math.max(...sys)) + 1 - top, -left, -top);

  for (let py = 0; py < pc.height; py++) {
    for (let px = 0; px < pc.width; px++) {
      const p = screenToWorld(px + 0.5 - pc.ox, py + 0.5 - pc.oy);
      if (p.x < 0 || p.y < 0 || p.x > room.width || p.y > room.height) continue;
      const along = win.wall === 'right' ? p.x : p.y;
      const into = win.wall === 'right' ? p.y : p.x;
      let v = leadInAt(win, ray, along, into);
      if (into >= ray.start) {
        const g = glassPointOf(win, ray, along, into);
        v = windowLightAt(win, ray, g.u, g.z);
      }
      const a = quantizeLight(v, px, py);
      if (a > 0) pc.set(px, py, color, Math.round(a * 255));
    }
  }
  return { canvas: pc.toCanvas(), anchorX: pc.ox, anchorY: pc.oy };
}

/**
 * The light in the air between the glass and its floor patch: a soft volume
 * that links window and floor. Built by marching rays from a grid of glass
 * points to where they land (projectToFloor) and splatting them into screen
 * pixels, so its outline is exactly the 3D volume seen in iso. It fades in
 * just off the glass, is densest in the middle of the beam and thins near
 * the floor and at the sides; then reduced to the same few pixel-art levels as the floor.
 */
export function drawLightShaft(win: WindowPlacement, ray: SunRay, color: number): LayerArt {
  const N = 36; // glass samples per axis
  const M = 90; // steps along each ray
  const pts: { x: number; y: number; w: number }[] = [];
  for (let i = 0; i < N; i++) {
    const su = (i + 0.5) / N;
    const u = win.u0 + su * (win.u1 - win.u0);
    for (let j = 0; j < N; j++) {
      const tz = (j + 0.5) / N;
      const z = win.z0 + tz * (win.z1 - win.z0);
      const f = projectToFloor(win, ray, u, z);
      const g = toFloor(win, u, 0);
      const side = Math.min(1, Math.min(su, 1 - su) / 0.25);
      for (let k = 0; k <= M; k++) {
        const s = k / M;
        const x = g.x + (f.x - g.x) * s;
        const y = g.y + (f.y - g.y) * s;
        // Fade in off the glass (so the window itself isn't washed out) and thin toward the floor.
        pts.push({ x: (x - y) * 16, y: (x + y) * 8 - z * (1 - s), w: side * Math.min(1, s / 0.18) * (1 - 0.45 * s) });
      }
    }
  }
  // (Loops, not Math.min(...pts): ~100k samples would overflow the call stack.)
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const left = Math.floor(minX) - 1;
  const top = Math.floor(minY) - 1;
  const width = Math.ceil(maxX) + 2 - left;
  const height = Math.ceil(maxY) + 2 - top;
  const acc = new Float32Array(width * height);
  for (const p of pts) {
    const i = Math.floor(p.y - top) * width + Math.floor(p.x - left);
    acc[i] = (acc[i] ?? 0) + p.w;
  }

  // Smooth the splats a little (3x3 box) so sparse spots don't speckle.
  const sm = new Float32Array(width * height);
  let max = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += acc[(y + dy) * width + x + dx] ?? 0;
      sm[y * width + x] = sum;
      if (sum > max) max = sum;
    }
  }
  const pc = new PixelCanvas(width, height, -left, -top);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.sqrt((sm[y * width + x] ?? 0) / max) * 1.15;
      // Top level capped so the densest part (in front of the wall under the
      // window) stays a soft haze instead of a flat white block.
      const a = Math.min(0.65, quantizeLight(Math.min(1, v), x, y));
      if (a > 0) pc.set(x, y, color, Math.round(a * 255));
    }
  }
  return { canvas: pc.toCanvas(), anchorX: pc.ox, anchorY: pc.oy };
}

/**
 * Sheen on the glass, with its strength baked in (one texture per look):
 * a flat wash of `alpha` in two bands (a little stronger at the top, no
 * dithering so the sky's own dither stays clean) plus two thin diagonal
 * glints in the upper-left pane at about 3x the wash. Same size as the scenery.
 */
export function drawGlassSheen(g: GlassGeometry, color: number, alpha: number): HTMLCanvasElement {
  const pc = new PixelCanvas(g.width, g.height);
  const glintColor = mix(color, 0xffffff, 0.6);
  for (let x = 0; x < g.width; x++) {
    const top = g.top[x] ?? -1;
    const bottom = g.bottom[x] ?? -1;
    if (top < 0) continue;
    for (let y = top; y <= bottom; y++) {
      if (!g.mask[y * g.width + x]) continue;
      const t = (y - top) / Math.max(1, bottom - top);
      // Glints: two 1px diagonals rising to the right, relative to the column top.
      const d = y - top + (x - g.width * 0.42) * 1.1;
      const glint = x < g.width * 0.42 && t < 0.45 && (Math.round(d) === -2 || Math.round(d) === -6);
      if (glint) pc.set(x, y, glintColor, Math.round(Math.min(0.6, alpha * 2.5) * 255));
      else pc.set(x, y, color, Math.round(alpha * (t < 0.3 ? 1.25 : 0.9) * 255));
    }
  }
  return pc.toCanvas();
}

/**
 * Glow around a window, made like the lamp halo (RoomLighting): stepped
 * alpha rings with a checkered outer ring, in a saturated tint so ADD gives
 * a colored glow instead of a white wash. Distance is measured on the wall
 * plane from the glass edge, so the glow hugs the window's iso shape. The
 * glass itself is left out (the sheen lights it) so the sky stays readable.
 */
export function drawWindowGlow(win: WindowPlacement, color: number): LayerArt {
  const REACH = 24; // px of glow beyond the glass
  const U_PX = 20; // one tile along the wall counts as this many px of distance
  const pad = REACH / U_PX;
  const b = wallRectBounds(win.wall, win.u0 - pad, win.u1 + pad, win.z0 - REACH, win.z1 + REACH);
  const pc = new PixelCanvas(b.right - b.x, b.bottom - b.y, -b.x, -b.y);
  for (let py = 0; py < pc.height; py++) {
    for (let px = 0; px < pc.width; px++) {
      const sx = px + 0.5 - pc.ox;
      const sy = py + 0.5 - pc.oy;
      const u = win.wall === 'right' ? sx / 16 : -sx / 16;
      const z = u * 8 - sy;
      const du = Math.max(win.u0 - u, 0, u - win.u1) * U_PX;
      const dz = Math.max(win.z0 - z, 0, z - win.z1);
      if (du === 0 && dz === 0) continue; // glass
      const d = Math.hypot(du, dz);
      const a = d <= 4 ? 115 : d <= 10 ? 80 : d <= 17 ? ((px + py) % 2 ? 52 : 36) : d <= REACH ? ((px + py) % 2 ? 26 : 0) : 0;
      if (a) pc.set(px, py, color, a);
    }
  }
  return { canvas: pc.toCanvas(), anchorX: pc.ox, anchorY: pc.oy };
}
