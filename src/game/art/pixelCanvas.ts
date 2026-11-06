import { TILE_H, TILE_W } from '../core/iso';

/**
 * Tiny software rasterizer for placeholder pixel art. Everything is drawn
 * pixel-by-pixel (no anti-aliasing) so it stays crisp at any integer zoom.
 *
 * Iso helpers use the same projection as the game (2:1, 32x16 tiles) in a
 * local frame whose world origin (0,0,0) sits at pixel (ox, oy).
 */
export class PixelCanvas {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  /**
   * Optional depth buffer (see useDepth). Depth is X + Y of the visible world
   * point: along any screen pixel's view ray, larger X + Y is nearer the
   * viewer. Without it, later drawing simply covers earlier drawing.
   */
  private depth: Float32Array | null = null;

  constructor(
    readonly width: number,
    readonly height: number,
    /** Pixel position of the local world origin (for iso helpers). */
    readonly ox = 0,
    readonly oy = 0,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  /**
   * Turns on depth testing: a pixel is only drawn if nothing nearer is there
   * yet (coplanar details drawn later still win). Used for turned-around
   * furniture, where the drawing order written for the front view would let
   * far parts cover near ones, and details on faces now turned away vanish.
   */
  useDepth(): void {
    this.depth = new Float32Array(this.width * this.height).fill(-Infinity);
  }

  /** set() with a depth test when depth testing is on. */
  private plot(x: number, y: number, color: number, d: number, alpha = 255): void {
    const z = this.depth;
    if (z) {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
      const i = y * this.width + x;
      if (d < (z[i] as number) - DEPTH_EPS) return;
      z[i] = Math.max(z[i] as number, d);
    }
    this.set(x, y, color, alpha);
  }

  set(x: number, y: number, color: number, alpha = 255): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = (color >> 16) & 0xff;
    this.data[i + 1] = (color >> 8) & 0xff;
    this.data[i + 2] = color & 0xff;
    this.data[i + 3] = alpha;
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color);
  }

  /**
   * Stamps a sprite given as rows of palette characters ('.' = transparent).
   * This is the format used for hand-made placeholder sprites.
   */
  stamp(x: number, y: number, rows: readonly string[], palette: Readonly<Record<string, number>>, flipX = false): void {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[flipX ? row.length - 1 - i : i] ?? '.';
        const color = palette[ch];
        if (ch !== '.' && color !== undefined) this.set(x + i, y + j, color);
      }
    });
  }

  /**
   * Draws a solid iso box. (x, y) is its back corner in world tiles, (wx, wy)
   * its footprint, z/hz its bottom height and height in pixels. Boxes must be
   * drawn back-to-front within one sprite.
   */
  isoBox(x: number, y: number, z: number, wx: number, wy: number, hz: number, c: BoxColors): void {
    const mask = new Uint8Array(this.width * this.height); // 0 none, 1 top, 2 left, 3 right
    const depth = this.depth ? new Float32Array(this.width * this.height) : null;
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    // Screen bounds of the box (local pixels).
    const left = Math.floor(this.ox + (x - (y + wy)) * hw);
    const right = Math.ceil(this.ox + (x + wx - y) * hw);
    const top = Math.floor(this.oy + (x + y) * hh - z - hz);
    const bottom = Math.ceil(this.oy + (x + wx + y + wy) * hh - z);

    for (let py = Math.max(0, top); py < Math.min(this.height, bottom); py++) {
      for (let px = Math.max(0, left); px < Math.min(this.width, right); px++) {
        const sx = (px + 0.5 - this.ox) / hw;
        const sy = (py + 0.5 - this.oy + z) / hh;
        // Top face: floor point under the pixel lifted by hz.
        const ty = sy + hz / hh;
        const tX = (sx + ty) / 2 - x;
        const tY = (ty - sx) / 2 - y;
        let face = 0;
        if (tX >= 0 && tX <= wx && tY >= 0 && tY <= wy) face = 1;
        else {
          // Front-left face (world plane Y = y + wy).
          const lX = sx + (y + wy) - x;
          const lz = (lX + x + y + wy) - sy; // height in half-tile units
          if (lX >= 0 && lX <= wx && lz >= 0 && lz <= hz / hh) face = 2;
          else {
            // Front-right face (world plane X = x + wx).
            const rY = x + wx - sx - y;
            const rz = (x + wx + rY + y) - sy;
            if (rY >= 0 && rY <= wy && rz >= 0 && rz <= hz / hh) face = 3;
          }
        }
        if (face) {
          mask[py * this.width + px] = face;
          // X + Y of the visible point: top face, plane Y = y + wy, or plane X = x + wx.
          if (depth) depth[py * this.width + px] = face === 1 ? ty : face === 2 ? sx + 2 * (y + wy) : 2 * (x + wx) - sx;
        }
      }
    }

    for (let py = Math.max(0, top); py < Math.min(this.height, bottom); py++) {
      for (let px = Math.max(0, left); px < Math.min(this.width, right); px++) {
        const face = mask[py * this.width + px];
        if (!face) continue;
        const at = (dx: number, dy: number) => {
          const qx = px + dx;
          const qy = py + dy;
          return qx < 0 || qy < 0 || qx >= this.width || qy >= this.height ? 0 : mask[qy * this.width + qx];
        };
        const silhouette = !at(1, 0) || !at(-1, 0) || !at(0, 1) || !at(0, -1);
        const d = depth ? (depth[py * this.width + px] as number) : 0;
        if (silhouette) this.plot(px, py, c.outline, d);
        else if (face === 1 && at(0, 1) !== 1 && c.edge !== undefined) this.plot(px, py, c.edge, d);
        else this.plot(px, py, face === 1 ? c.top : face === 2 ? c.left : c.right, d);
      }
    }
  }

  /**
   * Fills a rectangle lying on a vertical plane: plane 'y' is Y = c (faces +y,
   * drawn spanning X in [u0, u1]); plane 'x' is X = c (faces +x, spanning Y).
   * Heights z0..z1 in pixels. Used for shelves, windows, wallpaper, etc.
   * alpha 0 erases (used to cut the glass out of a window frame).
   */
  planeRect(plane: 'x' | 'y', c: number, u0: number, u1: number, z0: number, z1: number, color: number, alpha = 255): void {
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    for (let px = 0; px < this.width; px++) {
      const sx = (px + 0.5 - this.ox) / hw;
      const u = plane === 'y' ? sx + c : c - sx;
      if (u < u0 || u > u1) continue;
      const base = this.oy + (c + u) * hh;
      const d = plane === 'y' ? u + c : c + u;
      for (let py = Math.ceil(base - z1 - 0.5); py <= Math.floor(base - z0 - 0.5); py++) this.plot(px, py, color, d, alpha);
    }
  }

  /** Fills a rectangle on a horizontal plane at height z (world tiles). */
  floorRect(x0: number, y0: number, x1: number, y1: number, z: number, color: number): void {
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    for (let py = 0; py < this.height; py++) {
      for (let px = 0; px < this.width; px++) {
        const sx = (px + 0.5 - this.ox) / hw;
        const sy = (py + 0.5 - this.oy + z) / hh;
        const X = (sx + sy) / 2;
        const Y = (sy - sx) / 2;
        if (X >= x0 && X <= x1 && Y >= y0 && Y <= y1) this.plot(px, py, color, X + Y);
      }
    }
  }

  /**
   * A rounded solid (round table top, beanbag) given as a height field:
   * h(X, Y) is the height in pixels above z at floor point (X, Y), 0 or less
   * outside the shape. Each pixel is shaded like isoBox faces: flat parts take
   * the top color, slopes and sides facing +y the lit left color and those
   * facing +x the shaded right color, with an outline around the silhouette.
   */
  heightField(x0: number, y0: number, x1: number, y1: number, z: number, hMax: number, h: (X: number, Y: number) => number, c: BoxColors): void {
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const mask = new Uint8Array(this.width * this.height);
    const depth = this.depth ? new Float32Array(this.width * this.height) : null;
    const left = Math.max(0, Math.floor(this.ox + (x0 - y1) * hw));
    const right = Math.min(this.width, Math.ceil(this.ox + (x1 - y0) * hw));
    const top = Math.max(0, Math.floor(this.oy + (x0 + y0) * hh - z - hMax));
    const bottom = Math.min(this.height, Math.ceil(this.oy + (x1 + y1) * hh - z));
    const eps = 0.04;
    for (let py = top; py < bottom; py++) {
      for (let px = left; px < right; px++) {
        const sx = (px + 0.5 - this.ox) / hw;
        // March down from the top: the first point inside the shape is what we see.
        for (let dz = hMax; dz >= 0; dz -= 0.5) {
          const sy = (py + 0.5 - this.oy + z + dz) / hh;
          const X = (sx + sy) / 2;
          const Y = (sy - sx) / 2;
          if (X < x0 || X > x1 || Y < y0 || Y > y1) continue;
          const here = h(X, Y);
          if (here <= 0 || here < dz) continue;
          // Slope toward +x / +y (pixels of height per tile).
          const gx = (h(X + eps, Y) - h(X - eps, Y)) / (2 * eps);
          const gy = (h(X, Y + eps) - h(X, Y - eps)) / (2 * eps);
          const wall = here - dz > 1.5; // hit a vertical side below the rim
          let face = 1;
          if (wall || Math.hypot(gx, gy) > 40) face = -gy >= -gx ? 2 : 3;
          mask[py * this.width + px] = face;
          if (depth) depth[py * this.width + px] = X + Y;
          break;
        }
      }
    }
    for (let py = top; py < bottom; py++) {
      for (let px = left; px < right; px++) {
        const face = mask[py * this.width + px];
        if (!face) continue;
        const at = (dx: number, dy: number) => {
          const qx = px + dx;
          const qy = py + dy;
          return qx < 0 || qy < 0 || qx >= this.width || qy >= this.height ? 0 : mask[qy * this.width + qx];
        };
        const silhouette = !at(1, 0) || !at(-1, 0) || !at(0, 1) || !at(0, -1);
        const d = depth ? (depth[py * this.width + px] as number) : 0;
        if (silhouette) this.plot(px, py, c.outline, d);
        else if (face === 1 && (at(0, 1) ?? 0) > 1 && c.edge !== undefined) this.plot(px, py, c.edge, d);
        else this.plot(px, py, face === 1 ? c.top : face === 2 ? c.left : c.right, d);
      }
    }
  }

  /** Pixel position of a local world point (for placing details). */
  at(x: number, y: number, z = 0): { x: number; y: number } {
    return {
      x: Math.round(this.ox + (x - y) * (TILE_W / 2)),
      y: Math.round(this.oy + (x + y) * (TILE_H / 2) - z),
    };
  }

  toCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.putImageData(new ImageData(this.data, this.width, this.height), 0, 0);
    return canvas;
  }
}

/** Coplanar surfaces (a detail painted on a face) compare equal within this. */
const DEPTH_EPS = 0.03;

export interface BoxColors {
  top: number;
  left: number;
  right: number;
  outline: number;
  /** Optional highlight line along the front edges of the top face. */
  edge?: number;
}

/** Builds box colors from one base color with simple light/shade steps. */
export function shade(base: number, outline: number, edge?: number): BoxColors {
  return { top: base, left: mix(base, 0x000000, 0.12), right: mix(base, 0x000000, 0.24), outline, edge };
}

export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => {
    const ca = (a >> s) & 0xff;
    const cb = (b >> s) & 0xff;
    return Math.round(ca + (cb - ca) * t) << s;
  };
  return ch(16) | ch(8) | ch(0);
}
