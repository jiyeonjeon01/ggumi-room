import { TILE_H, TILE_W } from '../core/iso';
import { mix, PixelCanvas, shade } from './pixelCanvas';
import type { RoomTheme } from './themes';

export const WALL_HEIGHT = 84;
export const WALL_THICKNESS = 0.25;
export const FLOOR_THICKNESS = 6;
const PAD = 2;

/** A generated layer image plus where world (0,0,0) lies inside it. */
export interface LayerArt {
  canvas: HTMLCanvasElement;
  anchorX: number;
  anchorY: number;
}

/** Floor slab with a checker tile pattern. */
export function drawFloor(w: number, h: number, t: RoomTheme): LayerArt {
  const ox = h * (TILE_W / 2) + PAD;
  const oy = PAD + FLOOR_THICKNESS;
  const pc = new PixelCanvas((w + h) * (TILE_W / 2) + PAD * 2, (w + h) * (TILE_H / 2) + FLOOR_THICKNESS * 2 + PAD * 2, ox, oy);
  pc.isoBox(0, 0, -FLOOR_THICKNESS, w, h, FLOOR_THICKNESS, {
    top: t.floorA,
    left: t.floorSide,
    right: mix(t.floorSide, 0x000000, 0.12),
    outline: t.outline,
  });
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if ((x + y) % 2) pc.floorRect(x + 0.03, y + 0.03, x + 0.97, y + 0.97, 0, t.floorB);
    }
  }
  // Soft highlight seams on the tile grid.
  const seam = mix(t.floorA, 0xffffff, 0.35);
  for (let x = 1; x < w; x++) pc.floorRect(x - 0.02, 0.05, x + 0.02, h - 0.05, 0, seam);
  for (let y = 1; y < h; y++) pc.floorRect(0.05, y - 0.02, w - 0.05, y + 0.02, 0, seam);
  return { canvas: pc.toCanvas(), anchorX: ox, anchorY: oy };
}

/**
 * The two back walls (left wall at x = 0 running along y, right wall at
 * y = 0 running along x) with wallpaper, baseboard and wall decorations.
 * Windows are separate layers (art/windowArt.ts) so their view can change.
 * The two front walls are left open (cutaway view), like a diorama.
 */
/** Wall decorations: the personal room's frame/shelf/garland, or the party lounge's. */
export type WallDecor = 'personal' | 'lounge';

export function drawWalls(w: number, h: number, t: RoomTheme, decor: WallDecor = 'personal'): LayerArt {
  const T = WALL_THICKNESS;
  const ox = (h + T) * (TILE_W / 2) + PAD;
  const oy = WALL_HEIGHT + T * TILE_H + PAD;
  const pc = new PixelCanvas(
    Math.ceil((w + h + 2 * T) * (TILE_W / 2)) + PAD * 2,
    Math.ceil(oy + (w + h) * (TILE_H / 2)) + PAD,
    ox,
    oy,
  );
  const cap = mix(t.wallTrim, 0xffffff, 0.2);
  // Right wall (behind), then left wall. Inner faces are "left"/"right" faces.
  pc.isoBox(-T, -T, 0, w + T, T, WALL_HEIGHT, { top: cap, left: t.wallRight, right: mix(t.wallRight, 0, 0.2), outline: t.outline });
  pc.isoBox(-T, 0, 0, T, h, WALL_HEIGHT, { top: cap, left: mix(t.wallLeft, 0, 0.2), right: t.wallLeft, outline: t.outline });

  // Wallpaper stripes.
  for (let u = 0.5; u < w - 0.2; u += 0.5) pc.planeRect('y', 0, u - 0.03, u + 0.03, 12, WALL_HEIGHT - 4, t.wallPattern);
  for (let u = 0.5; u < h - 0.2; u += 0.5) pc.planeRect('x', 0, u - 0.03, u + 0.03, 12, WALL_HEIGHT - 4, t.wallPattern);
  // Baseboards.
  pc.planeRect('y', 0, 0.05, w - 0.05, 1, 8, t.wallTrim);
  pc.planeRect('x', 0, 0.05, h - 0.05, 1, 8, t.wallTrim);
  pc.planeRect('y', 0, 0.05, w - 0.05, 8, 9, mix(t.wallTrim, t.outline, 0.4));
  pc.planeRect('x', 0, 0.05, h - 0.05, 8, 9, mix(t.wallTrim, t.outline, 0.4));

  if (decor === 'lounge') {
    drawLoungeDecor(pc, t, w, h);
  } else {
    drawFrame(pc, t, 4.6, 5.6);
    drawShelf(pc, t, 0.7, 2.3);
    drawGarland(pc, t, 3.6, 7.4);
  }
  return { canvas: pc.toCanvas(), anchorX: ox, anchorY: oy };
}

/**
 * Party lounge: string lights running along both walls, two little posters
 * and a pennant banner, so it reads as a different, bigger place.
 */
function drawLoungeDecor(pc: PixelCanvas, t: RoomTheme, w: number, h: number): void {
  const bulbs = [0xffe38a, t.accent, 0x9fd3c7, 0xb7a6f0];
  const lights = (plane: 'x' | 'y', length: number) => {
    // Wire with gentle sags between hooks, a bulb at the bottom of each sag.
    const seg = 1.5;
    for (let u = 0.3; u < length - 0.3; u += 0.05) {
      const k = ((u - 0.3) % seg) / seg;
      const sag = Math.sin(k * Math.PI) * 5;
      pc.planeRect(plane, 0, u - 0.03, u + 0.03, 82 - sag, 83 - sag, t.outline);
    }
    let i = 0;
    for (let u = 0.3 + seg / 2; u < length - 0.3; u += seg / 2, i++) {
      const k = ((u - 0.3) % seg) / seg;
      const z = 82 - Math.sin(k * Math.PI) * 5;
      const c = bulbs[i % bulbs.length] as number;
      pc.planeRect(plane, 0, u - 0.07, u + 0.07, z - 5, z - 1, mix(c, t.outline, 0.35));
      pc.planeRect(plane, 0, u - 0.05, u + 0.05, z - 4, z - 1, c);
    }
  };
  lights('y', w);
  lights('x', h);
  // Posters on the left wall.
  const poster = (u0: number, u1: number, c: number) => {
    pc.planeRect('x', 0, u0 - 0.05, u1 + 0.05, 34, 66, t.outline);
    pc.planeRect('x', 0, u0, u1, 36, 64, mix(c, 0xffffff, 0.55));
    pc.planeRect('x', 0, u0 + 0.15, u1 - 0.15, 44, 56, c);
    pc.planeRect('x', 0, u0 + 0.25, u1 - 0.25, 40, 42, mix(c, t.outline, 0.3));
  };
  poster(2.0, 3.2, t.accent);
  poster(9.0, 10.2, 0x9fd3c7);
  // Pennant banner on the right wall, between the windows.
  const u0 = 7.6;
  const u1 = Math.min(w - 0.6, 11.4);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const u = u0 + ((u1 - u0) * (i + 0.5)) / n;
    const c = i % 2 ? t.accent : 0xffe38a;
    for (let k = 0; k < 5; k++) pc.planeRect('y', 0, u - 0.12 + k * 0.024, u + 0.12 - k * 0.024, 70 - k * 2, 72 - k * 2, c);
  }
  pc.planeRect('y', 0, u0, u1, 72, 73, t.outline);
}

function drawFrame(pc: PixelCanvas, t: RoomTheme, u0: number, u1: number): void {
  pc.planeRect('x', 0, u0 - 0.06, u1 + 0.06, 38, 66, t.outline);
  pc.planeRect('x', 0, u0, u1, 40, 64, mix(t.wood, 0xffffff, 0.3));
  pc.planeRect('x', 0, u0 + 0.12, u1 - 0.12, 43, 61, 0xffffff);
  // Tiny heart.
  const m = (u0 + u1) / 2;
  pc.planeRect('x', 0, m - 0.2, m - 0.04, 52, 56, t.accent);
  pc.planeRect('x', 0, m + 0.04, m + 0.2, 52, 56, t.accent);
  pc.planeRect('x', 0, m - 0.16, m + 0.16, 48, 53, t.accent);
  pc.planeRect('x', 0, m - 0.06, m + 0.06, 46, 48, t.accent);
}

function drawShelf(pc: PixelCanvas, t: RoomTheme, u0: number, u1: number): void {
  const wood = shade(t.wood, t.outline, mix(t.wood, 0xffffff, 0.35));
  // A thin box sticking out of the left wall.
  pc.isoBox(0, u0, 50, 0.35, u1 - u0, 3, wood);
  const books = [t.accent, 0x9fd3c7, 0xffd98a, t.fabric];
  books.forEach((c, i) => {
    const y = u0 + 0.15 + i * 0.13;
    pc.isoBox(0.05, y, 53, 0.25, 0.1, 9 + (i % 2) * 2, shade(c, t.outline));
  });
  pc.isoBox(0.06, u1 - 0.55, 53, 0.25, 0.25, 6, shade(mix(t.wood, 0xffffff, 0.3), t.outline));
  pc.isoBox(0.1, u1 - 0.51, 59, 0.17, 0.17, 6, shade(0x6fbf6a, t.outline));
}

function drawGarland(pc: PixelCanvas, t: RoomTheme, u0: number, u1: number): void {
  const n = 7;
  for (let i = 0; i <= n * 4; i++) {
    const u = u0 + ((u1 - u0) * i) / (n * 4);
    const sag = Math.sin(((i % 4) / 4) * Math.PI) * 4;
    pc.planeRect('x', 0, u - 0.03, u + 0.03, 78 - sag, 79 - sag, t.outline);
  }
  for (let i = 0; i < n; i++) {
    const u = u0 + ((u1 - u0) * (i + 0.5)) / n;
    pc.planeRect('x', 0, u - 0.1, u + 0.1, 70, 75, i % 2 ? t.accent : 0xffe38a);
    pc.planeRect('x', 0, u - 0.06, u + 0.06, 68, 70, i % 2 ? t.accent : 0xffe38a);
  }
}
