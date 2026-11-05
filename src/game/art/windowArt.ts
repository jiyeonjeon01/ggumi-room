import type { EnvLook } from '../environment/look';
import type { WindowPlacement } from '../room/roomData';
import { mix, PixelCanvas } from './pixelCanvas';
import type { LayerArt } from './roomArt';
import type { RoomTheme } from './themes';

/**
 * Windows are split in two independent layers:
 *  - the frame overlay (frame, mullions, curtains) — static, per theme;
 *  - the scenery behind the glass (sky, sun/moon, clouds, stars) — redrawn
 *    in software whenever the visible pixels change.
 * The scenery is clipped per pixel to the glass shape (a parallelogram on the
 * wall), so nothing can poke outside the frame, and both WebGL and Canvas
 * renderers show identical, crisp results without relying on mask filters.
 * The sky itself is far away, so it is drawn upright in screen space; only
 * the clip follows the iso wall.
 */

const planeOf = (w: WindowPlacement) => (w.wall === 'right' ? 'y' : 'x');

/** Screen-space bounds (world pixels, origin = world (0,0,0)) of a rect on a back wall. */
export function wallRectBounds(wall: WindowPlacement['wall'], u0: number, u1: number, z0: number, z1: number) {
  const xs = wall === 'right' ? [u0 * 16, u1 * 16] : [-u1 * 16, -u0 * 16];
  return {
    x: Math.floor(Math.min(...xs)) - 1,
    y: Math.floor(Math.min(u0, u1) * 8 - z1) - 1,
    right: Math.ceil(Math.max(...xs)) + 1,
    bottom: Math.ceil(Math.max(u0, u1) * 8 - z0) + 1,
  };
}

// ---------------------------------------------------------------- frame

export function drawWindowFrame(win: WindowPlacement, t: RoomTheme): LayerArt {
  const { u0, u1, z0, z1 } = win;
  const b = wallRectBounds(win.wall, u0 - 0.5, u1 + 0.5, z0 - 12, z1 + 10);
  const pc = new PixelCanvas(b.right - b.x, b.bottom - b.y, -b.x, -b.y);
  const plane = planeOf(win);
  const rect = (a0: number, a1: number, h0: number, h1: number, color: number, alpha = 255) =>
    pc.planeRect(plane, 0, a0, a1, h0, h1, color, alpha);

  const frame = mix(t.wallTrim, 0xffffff, 0.3);
  rect(u0 - 0.1, u1 + 0.1, z0 - 4, z1 + 4, t.outline);
  rect(u0 - 0.06, u1 + 0.06, z0 - 2, z1 + 2, frame);
  rect(u0, u1, z0, z1, 0, 0); // cut out the glass
  rect(u0, u1, z1 - 1, z1, mix(frame, t.outline, 0.45)); // inner shadow under the header
  const mid = (u0 + u1) / 2;
  const sill = z0 + Math.round((z1 - z0) * 0.47);
  rect(mid - 0.04, mid + 0.04, z0, z1, frame);
  rect(u0, u1, sill, sill + 2, frame);
  // Curtains and rod.
  const light = mix(t.fabric, 0xffffff, 0.4);
  rect(u0 - 0.35, u0 - 0.05, z0 - 10, z1 + 6, t.fabric);
  rect(u1 + 0.05, u1 + 0.35, z0 - 10, z1 + 6, t.fabric);
  rect(u0 - 0.2, u0 - 0.15, z0 - 10, z1 + 6, light);
  rect(u1 + 0.15, u1 + 0.2, z0 - 10, z1 + 6, light);
  rect(u0 - 0.45, u1 + 0.45, z1 + 6, z1 + 8, t.outline);
  return { canvas: pc.toCanvas(), anchorX: -b.x, anchorY: -b.y };
}

// ---------------------------------------------------------------- scenery

/** Pixel footprint of a window's glass, computed once per window. */
export interface GlassGeometry {
  /** Top-left of the scenery image in world pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1 where the glass is (scenery visible), 0 elsewhere. */
  mask: Uint8Array;
  /** First / last glass row per column (-1 when the column has no glass). */
  top: Int16Array;
  bottom: Int16Array;
  stars: readonly { x: number; y: number }[];
}

export const MAX_STARS = 12;

export function glassGeometry(win: WindowPlacement): GlassGeometry {
  const b = wallRectBounds(win.wall, win.u0, win.u1, win.z0, win.z1);
  const width = b.right - b.x;
  const height = b.bottom - b.y;
  const pc = new PixelCanvas(width, height, -b.x, -b.y);
  pc.planeRect(planeOf(win), 0, win.u0, win.u1, win.z0, win.z1, 0xffffff);
  const mask = new Uint8Array(width * height);
  const top = new Int16Array(width).fill(-1);
  const bottom = new Int16Array(width).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((pc.data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
      mask[y * width + x] = 1;
      if (top[x] === -1) top[x] = y;
      bottom[x] = y;
    }
  }

  // Scatter stars inside the glass, away from edges, the moon and each other.
  const rand = mulberry32(Math.round(win.u0 * 1000 + win.z0));
  const stars: { x: number; y: number }[] = [];
  const inner = (x: number, y: number) =>
    [-2, 0, 2].every((d) => mask[(y + d) * width + x] === 1 && mask[y * width + x + d] === 1);
  for (let tries = 0; tries < 400 && stars.length < MAX_STARS; tries++) {
    const x = Math.floor(rand() * width);
    const y = Math.floor(rand() * height);
    if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2 || !inner(x, y)) continue;
    if (x < 11 && y - (top[x] ?? 0) < 11) continue; // moon corner
    if (stars.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) < 5)) continue;
    stars.push({ x, y });
  }
  return { x: b.x, y: b.y, width, height, mask, top, bottom, stars };
}

/** Animated part of the scenery, already quantized to whole pixels/levels. */
export interface SceneryState {
  /** Horizontal travel of each cloud in pixels (wrapped by the renderer). */
  clouds: readonly number[];
  /** Star brightness levels 0..3 (0 = barely visible). */
  stars: readonly number[];
}

const CLOUDS = [
  [
    '....kkk....',
    '..kkLLLkk..',
    '.kLLLLLLLk.',
    'kLLLLLLLLLk',
    'kSSLLLLSSLk',
    '.kkkkkkkkk.',
  ],
  [
    '..kkk...',
    '.kLLLkk.',
    'kLLLLLLk',
    'kSLLLSSk',
    '.kkkkkk.',
  ],
] as const;

/** Gap (px) a cloud stays fully hidden before re-entering, so wrapping is never seen. */
const CLOUD_GAP = 6;

export function cloudSpan(g: GlassGeometry, index: number): number {
  return g.width + (CLOUDS[index % CLOUDS.length]?.[0]?.length ?? 0) + CLOUD_GAP;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Renders the scenery for one window into RGBA pixels (pure; no DOM). */
export function composeScenery(g: GlassGeometry, look: EnvLook, state: SceneryState): PixelCanvas {
  const { width: W, height: H, top, bottom } = g;
  const pc = new PixelCanvas(W, H);
  const sky = look.sky;

  // Sky: vertical bands blended with an ordered dither (pixel-art gradient).
  const skyAt = (x: number, y: number): number => {
    const t = ((y + 0.5) / H) * (sky.length - 1);
    const i = Math.min(sky.length - 2, Math.floor(t));
    const f = t - i;
    const threshold = ((BAYER4[(y % 4) * 4 + (x % 4)] ?? 0) + 0.5) / 16;
    return (f > threshold ? sky[i + 1] : sky[i]) ?? 0;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pc.set(x, y, skyAt(x, y));

  // Stars (only on clear sky).
  g.stars.slice(0, look.starCount).forEach((s, i) => {
    const level = state.stars[i] ?? 2;
    const bg = skyAt(s.x, s.y);
    pc.set(s.x, s.y, mix(bg, look.star, [0.35, 0.6, 0.85, 1][level] ?? 1));
    if (level === 3) {
      const halo = mix(bg, look.star, 0.4);
      pc.set(s.x - 1, s.y, halo);
      pc.set(s.x + 1, s.y, halo);
      pc.set(s.x, s.y - 1, halo);
      pc.set(s.x, s.y + 1, halo);
    }
  });

  // Sun / moon, partly hidden by the frame.
  const colTop = (x: number) => top[Math.max(0, Math.min(W - 1, x))] ?? 0;
  const colBottom = (x: number) => bottom[Math.max(0, Math.min(W - 1, x))] ?? H - 1;
  switch (look.celestial) {
    case 'sun-high': {
      const cx = W - 5;
      disc(pc, skyAt, cx, colTop(cx) + 2, 5, 0xffe27a, 0xf0a040, 0xfff6c8);
      break;
    }
    case 'sun-low': {
      const cx = Math.floor(W * 0.42);
      disc(pc, skyAt, cx, colBottom(cx) + 1, 6, 0xffb25a, 0xe0704a, 0xffd89a);
      break;
    }
    case 'sun-rise': {
      const cx = Math.floor(W * 0.6);
      disc(pc, skyAt, cx, colBottom(cx) + 4, 6, 0xffd6a0, 0xf0a080, 0xfff0d8);
      break;
    }
    case 'moon': {
      const cx = 4;
      const cy = colTop(cx) + 5;
      moon(pc, cx, cy, 5, 0xfff1b0, 0xd8b860, 0xfffbe0);
      break;
    }
    case 'none':
      break;
  }

  // Clouds drift left-to-right and wrap while fully hidden.
  for (let i = 0; i < look.cloudCount && i < CLOUDS.length; i++) {
    const rows = CLOUDS[i];
    if (!rows) continue;
    const cw = rows[0]?.length ?? 0;
    const span = cloudSpan(g, i);
    const x = mod(Math.round(state.clouds[i] ?? 0), span) - cw;
    const midCol = Math.max(0, Math.min(W - 1, x + (cw >> 1)));
    const y = colTop(midCol) + Math.round((colBottom(midCol) - colTop(midCol)) * (i === 0 ? 0.28 : 0.55));
    pc.stamp(x, y, rows, { k: look.cloud.outline, L: look.cloud.light, S: look.cloud.shade });
  }

  // Clip to the glass.
  for (let i = 0; i < W * H; i++) if (!g.mask[i]) pc.data[i * 4 + 3] = 0;
  return pc;
}

/** Outlined disc with a dithered glow ring. */
function disc(
  pc: PixelCanvas,
  skyAt: (x: number, y: number) => number,
  cx: number,
  cy: number,
  r: number,
  fill: number,
  outline: number,
  highlight: number,
): void {
  for (let y = cy - r - 2; y <= cy + r + 2; y++) {
    for (let x = cx - r - 2; x <= cx + r + 2; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r - 0.5) pc.set(x, y, d < r * 0.45 && x <= cx && y <= cy ? highlight : fill);
      else if (d <= r + 0.5) pc.set(x, y, outline);
      else if (d <= r + 2 && (x + y) % 2 === 0) pc.set(x, y, mix(skyAt(Math.max(0, x), Math.max(0, y)), highlight, 0.45));
    }
  }
}

/** Outlined crescent: a disc minus an offset disc, lit on the left. */
function moon(pc: PixelCanvas, cx: number, cy: number, r: number, fill: number, outline: number, highlight: number): void {
  const inside = (x: number, y: number) =>
    Math.hypot(x - cx, y - cy) <= r - 0.5 && Math.hypot(x - (cx + 2.5), y - (cy - 1.5)) > r - 1;
  for (let y = cy - r - 1; y <= cy + r + 1; y++) {
    for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      if (!inside(x, y)) {
        if (inside(x + 1, y) || inside(x - 1, y) || inside(x, y + 1) || inside(x, y - 1)) pc.set(x, y, outline);
        continue;
      }
      pc.set(x, y, x < cx - 1 && y < cy ? highlight : fill);
    }
  }
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exposed for tests. */
export const CLOUD_SPRITES = CLOUDS;
