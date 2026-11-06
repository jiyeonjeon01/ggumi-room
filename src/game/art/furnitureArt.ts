import type { Facing } from '../core/placement';
import { FURNITURE, spriteFrame, type FurnitureId } from '../room/furniture';
import { mix, PixelCanvas, shade, type BoxColors } from './pixelCanvas';
import type { RoomTheme } from './themes';

/**
 * Placeholder furniture art, built from iso boxes and small hand-placed
 * details. Each function draws in the furniture's local world frame where
 * (0,0,0) is the back corner of its footprint on the floor.
 * Replace with real sprites by loading PNGs under the same texture keys and
 * following the sprite convention in room/furniture.ts.
 */
type Draw = (pc: IsoCanvas, t: RoomTheme) => void;

/** The drawing calls furniture art uses, in the piece's local world frame. */
interface IsoCanvas {
  isoBox(x: number, y: number, z: number, wx: number, wy: number, hz: number, c: BoxColors): void;
  planeRect(plane: 'x' | 'y', c: number, u0: number, u1: number, z0: number, z1: number, color: number, alpha?: number): void;
  floorRect(x0: number, y0: number, x1: number, y1: number, z: number, color: number): void;
  at(x: number, y: number, z?: number): { x: number; y: number };
  stamp(x: number, y: number, rows: readonly string[], palette: Readonly<Record<string, number>>, flipX?: boolean): void;
  heightField(x0: number, y0: number, x1: number, y1: number, z: number, hMax: number, h: (X: number, Y: number) => number, c: BoxColors): void;
}

/**
 * Draws a piece turned 90 degrees by swapping world x and y in every call.
 * Unlike mirroring the finished sprite, the canvas still decides which box
 * faces are lit (left) or shaded (right) from their real orientation, so the
 * light keeps coming from the same side.
 */
class AxisSwap implements IsoCanvas {
  constructor(private readonly pc: PixelCanvas) {}
  isoBox(x: number, y: number, z: number, wx: number, wy: number, hz: number, c: BoxColors): void {
    this.pc.isoBox(y, x, z, wy, wx, hz, c);
  }
  planeRect(plane: 'x' | 'y', c: number, u0: number, u1: number, z0: number, z1: number, color: number, alpha?: number): void {
    this.pc.planeRect(plane === 'x' ? 'y' : 'x', c, u0, u1, z0, z1, color, alpha);
  }
  floorRect(x0: number, y0: number, x1: number, y1: number, z: number, color: number): void {
    this.pc.floorRect(y0, x0, y1, x1, z, color);
  }
  at(x: number, y: number, z = 0): { x: number; y: number } {
    return this.pc.at(y, x, z);
  }
  stamp(x: number, y: number, rows: readonly string[], palette: Readonly<Record<string, number>>, flipX = false): void {
    this.pc.stamp(x, y, rows, palette, !flipX); // flat sprites (leaves) face the other way
  }
  heightField(x0: number, y0: number, x1: number, y1: number, z: number, hMax: number, h: (X: number, Y: number) => number, c: BoxColors): void {
    this.pc.heightField(y0, x0, y1, x1, z, hMax, (X, Y) => h(Y, X), c);
  }
}

/** Height of a dome (pixels) over an ellipse centered at (cx, cy) with radii rx, ry. */
const dome = (X: number, Y: number, cx: number, cy: number, rx: number, ry: number, height: number) => {
  const d = ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2;
  return d < 1 ? height * Math.sqrt(1 - d) : 0;
};
/** A flat disk (pixels high) of radius r around (cx, cy). */
const disk = (X: number, Y: number, cx: number, cy: number, r: number, height: number) => (Math.hypot(X - cx, Y - cy) < r ? height : 0);

const WHITE = 0xfffbfd;

const ART: Record<FurnitureId, Draw> = {
  bed(pc, t) {
    const wood = shade(t.wood, t.outline);
    pc.isoBox(0, 0, 0, 0.22, 2, 34, wood); // headboard against the wall
    pc.planeRect('x', 0.22, 0.4, 1.6, 22, 28, mix(t.wood, WHITE, 0.25));
    pc.isoBox(0.22, 0, 0, 2.78, 2, 10, wood); // frame
    pc.isoBox(0.3, 0.08, 10, 2.6, 1.84, 6, shade(WHITE, t.outline));
    pc.isoBox(0.38, 0.3, 16, 0.6, 1.4, 5, shade(WHITE, t.outline, mix(WHITE, t.fabric, 0.2)));
    pc.isoBox(1.15, 0.04, 10, 1.8, 1.92, 9, shade(t.fabric, t.outline, mix(t.fabric, WHITE, 0.4)));
    // Checked blanket pattern.
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if ((i + j) % 2) pc.floorRect(1.3 + i * 0.4, 0.2 + j * 0.42, 1.5 + i * 0.4, 0.4 + j * 0.42, 19, mix(t.fabric, WHITE, 0.45));
      }
    }
    pc.isoBox(1.15, 0.04, 19, 0.22, 1.92, 1, shade(mix(t.fabric, WHITE, 0.55), t.outline));
    pc.isoBox(2.86, 0, 0, 0.14, 2, 18, wood); // footboard
  },

  desk(pc, t) {
    const wood = shade(t.wood, t.outline, mix(t.wood, WHITE, 0.35));
    const leg = shade(mix(t.wood, 0x000000, 0.1), t.outline);
    pc.isoBox(0.05, 0.05, 0, 0.12, 0.12, 22, leg);
    pc.isoBox(0.05, 0.8, 0, 0.12, 0.12, 22, leg);
    pc.isoBox(1.3, 0.08, 0, 0.62, 0.84, 22, wood); // drawers
    pc.planeRect('y', 0.92, 1.38, 1.84, 13, 14, t.outline);
    pc.planeRect('y', 0.92, 1.55, 1.68, 17, 18, t.outline);
    pc.planeRect('y', 0.92, 1.55, 1.68, 7, 8, t.outline);
    pc.isoBox(0, 0, 22, 2, 1, 4, wood); // desk top
    // Monitor facing the room.
    pc.isoBox(0.98, 0.14, 26, 0.12, 0.1, 4, shade(0xd8d0e0, t.outline));
    pc.isoBox(0.6, 0.12, 30, 0.9, 0.08, 14, { top: 0xe8e2f0, left: 0xf7f2ff, right: 0xc8c0d8, outline: t.outline });
    pc.planeRect('y', 0.2, 0.68, 1.42, 32, 42, t.windowSky);
    pc.planeRect('y', 0.2, 0.96, 1.12, 35, 38, t.accent);
    pc.isoBox(0.55, 0.45, 26, 0.75, 0.25, 1, shade(WHITE, t.outline));
    pc.isoBox(1.55, 0.5, 26, 0.18, 0.18, 6, shade(t.accent, t.outline));
  },

  chair(pc, t) {
    // Seat faces -y (toward a desk against the back-right wall); backrest on the +y edge.
    const legs = shade(mix(t.wood, 0x000000, 0.1), t.outline);
    const wood = shade(t.wood, t.outline, mix(t.wood, WHITE, 0.35));
    for (const [x, y] of [[0.1, 0.1], [0.53, 0.1], [0.1, 0.53], [0.53, 0.53]] as const) pc.isoBox(x, y, 0, 0.1, 0.1, 11, legs);
    pc.isoBox(0.06, 0.06, 11, 0.63, 0.63, 3, wood); // seat board
    pc.isoBox(0.12, 0.1, 14, 0.5, 0.44, 2, shade(t.fabric, t.outline, mix(t.fabric, WHITE, 0.4))); // cushion
    pc.isoBox(0.06, 0.57, 14, 0.63, 0.12, 15, wood); // backrest
    pc.planeRect('y', 0.69, 0.18, 0.57, 19, 26, mix(t.wood, WHITE, 0.25));
  },

  bookshelf(pc, t) {
    const wood = shade(t.wood, t.outline, mix(t.wood, WHITE, 0.35));
    pc.isoBox(0, 0, 0, 1.5, 0.75, 64, wood);
    const front = (u0: number, u1: number, z0: number, z1: number, c: number) => pc.planeRect('y', 0.75, u0, u1, z0, z1, c);
    const inner = mix(t.wood, 0x000000, 0.35);
    const shadow = mix(t.wood, 0x000000, 0.5);
    const lit = mix(t.wood, WHITE, 0.3);
    // Lit front edge running up the near corner.
    front(0.02, 0.06, 1, 63, lit);
    const books = [t.accent, t.fabric, 0x9fd3c7, 0xffd98a, 0xb7a6f0, WHITE, 0x8fb8e8];
    for (let s = 0; s < 3; s++) {
      const z0 = 4 + s * 20;
      // Recessed compartment: back panel, a lit left inner wall (seen from the
      // front-left), the shelf floor catching light, and the board above
      // casting a shadow.
      front(0.08, 1.42, z0, z0 + 16, inner);
      front(0.08, 0.17, z0, z0 + 16, mix(t.wood, 0x000000, 0.18));
      front(0.08, 1.42, z0, z0 + 2, mix(t.wood, 0x000000, 0.1));
      front(0.17, 1.42, z0 + 14, z0 + 16, shadow);
      front(0.08, 1.42, z0 - 1, z0, lit); // lip of the shelf board
      // Books: 3-4 px wide spines with an outline, a shaded side and a
      // label band, so they read as books (thin strips with a lit top looked
      // like candles).
      let u = 0.2;
      let k = s * 2;
      while (u < 1.3) {
        const w = 0.2 + ((k * 37) % 3) * 0.04;
        const h = 9 + ((k * 13) % 4);
        const u1 = Math.min(1.4, u + w);
        const color = books[k % books.length] ?? WHITE;
        if (k % 5 !== 3) {
          front(u, u1, z0 + 2, z0 + 2 + h, mix(color, t.outline, 0.55)); // spine outline
          front(u + 0.05, u1 - 0.05, z0 + 2, z0 + 1 + h, color);
          front(u1 - 0.1, u1 - 0.05, z0 + 2, z0 + 1 + h, mix(color, 0x000000, 0.18)); // rounded, shaded side
          const band = z0 + 2 + Math.round(h * 0.55);
          front(u + 0.05, u1 - 0.05, band, band + 2, mix(color, WHITE, 0.55)); // label band
        }
        u += w + 0.02;
        k++;
      }
    }
  },

  nightstand(pc, t) {
    const wood = shade(t.wood, t.outline, mix(t.wood, WHITE, 0.35));
    pc.isoBox(0.04, 0.04, 0, 0.68, 0.68, 16, wood);
    pc.planeRect('x', 0.72, 0.18, 0.58, 7, 8, t.outline);
    pc.isoBox(0.24, 0.24, 16, 0.24, 0.24, 2, shade(0xf3e6c4, t.outline));
    pc.isoBox(0.33, 0.33, 18, 0.06, 0.06, 8, shade(0xf3e6c4, t.outline));
    pc.isoBox(0.18, 0.18, 26, 0.38, 0.38, 11, shade(0xfff1b8, t.outline, WHITE));
  },

  plant(pc, t) {
    pc.isoBox(0.17, 0.17, 0, 0.42, 0.42, 12, shade(mix(t.wood, WHITE, 0.25), t.outline, WHITE));
    const c = pc.at(0.375, 0.375, 12);
    pc.stamp(c.x - 9, c.y - 25, LEAVES, {
      k: 0x2f5a35,
      g: 0x6fbf6a,
      G: 0x9ad88a,
      d: 0x4d9a52,
    });
  },

  table(pc, t) {
    const legs = shade(mix(t.wood, 0x000000, 0.1), t.outline);
    pc.isoBox(0.15, 0.15, 0, 0.12, 0.12, 14, legs);
    pc.isoBox(0.98, 0.15, 0, 0.12, 0.12, 14, legs);
    pc.isoBox(0.15, 0.98, 0, 0.12, 0.12, 14, legs);
    pc.isoBox(0.98, 0.98, 0, 0.12, 0.12, 14, legs);
    pc.isoBox(0, 0, 14, 1.25, 1.25, 3, shade(mix(t.wood, WHITE, 0.3), t.outline, WHITE));
    pc.floorRect(0.12, 0.12, 1.13, 1.13, 17, mix(t.fabric, WHITE, 0.5));
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        if ((i + j) % 2) pc.floorRect(0.12 + i * 0.2, 0.12 + j * 0.2, 0.32 + i * 0.2, 0.32 + j * 0.2, 17, t.fabric);
      }
    }
    pc.isoBox(0.35, 0.35, 17, 0.2, 0.2, 5, shade(WHITE, t.outline));
    pc.isoBox(0.7, 0.62, 17, 0.28, 0.28, 4, shade(0xffe2b8, t.outline, t.accent));
  },

  cushion(pc, t) {
    pc.isoBox(0.04, 0.04, 0, 0.67, 0.67, 6, shade(t.fabric, t.outline, mix(t.fabric, WHITE, 0.4)));
  },

  sofa(pc, t) {
    // Two-seater: backrest along the back (-y) edge, seats face +y.
    const cloth = shade(t.fabric, t.outline, mix(t.fabric, WHITE, 0.4));
    const deep = shade(mix(t.fabric, 0x000000, 0.1), t.outline);
    const feet = shade(mix(t.wood, 0x000000, 0.15), t.outline);
    for (const [x, y] of [[0.08, 0.08], [1.8, 0.08], [0.08, 0.8], [1.8, 0.8]] as const) pc.isoBox(x, y, 0, 0.12, 0.12, 3, feet);
    pc.isoBox(0.04, 0.04, 3, 1.92, 0.92, 7, deep); // base
    pc.isoBox(0.04, 0.04, 10, 1.92, 0.3, 14, cloth); // backrest
    pc.isoBox(0.24, 0.34, 10, 0.76, 0.6, 5, cloth); // seat cushions
    pc.isoBox(1.0, 0.34, 10, 0.76, 0.6, 5, cloth);
    pc.isoBox(0.04, 0.04, 10, 0.2, 0.92, 9, cloth); // armrests
    pc.isoBox(1.76, 0.04, 10, 0.2, 0.92, 9, cloth);
    pc.isoBox(0.3, 0.36, 15, 0.38, 0.12, 7, shade(t.accent, t.outline, mix(t.accent, WHITE, 0.4))); // pillow
  },

  vanity(pc, t) {
    // Dressing table with a standing mirror at the back; drawers on the right.
    const wood = shade(t.wood, t.outline, mix(t.wood, WHITE, 0.35));
    const leg = shade(mix(t.wood, 0x000000, 0.1), t.outline);
    pc.isoBox(0.06, 0.08, 0, 0.1, 0.1, 18, leg);
    pc.isoBox(0.06, 0.58, 0, 0.1, 0.1, 18, leg);
    pc.isoBox(0.86, 0.08, 0, 0.6, 0.6, 18, wood); // drawers
    pc.planeRect('y', 0.68, 0.92, 1.4, 9, 10, t.outline);
    pc.planeRect('y', 0.68, 1.1, 1.22, 13, 15, mix(t.accent, WHITE, 0.2));
    pc.planeRect('y', 0.68, 1.1, 1.22, 4, 6, mix(t.accent, WHITE, 0.2));
    pc.isoBox(0, 0.04, 18, 1.5, 0.68, 3, shade(mix(t.wood, WHITE, 0.25), t.outline, WHITE)); // top
    // Mirror: frame, glass with two light streaks, rounded (stepped) top.
    pc.isoBox(0.28, 0.06, 21, 0.94, 0.1, 28, wood);
    pc.isoBox(0.42, 0.06, 49, 0.66, 0.1, 3, wood);
    const glass = mix(t.windowSky, WHITE, 0.45);
    pc.planeRect('y', 0.16, 0.36, 1.14, 24, 47, glass);
    pc.planeRect('y', 0.16, 0.5, 1.0, 47, 50, glass);
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 9; i++) {
        const u = 0.5 + k * 0.22 + i * 0.04;
        pc.planeRect('y', 0.16, u, u + 0.06, 28 + i * 2, 30 + i * 2, mix(glass, WHITE, 0.6));
      }
    }
    // Perfume bottle and a little jar.
    pc.isoBox(1.18, 0.4, 21, 0.12, 0.12, 6, shade(mix(t.accent, WHITE, 0.3), t.outline, WHITE));
    pc.isoBox(1.21, 0.43, 27, 0.06, 0.06, 2, shade(t.outline, t.outline));
    pc.isoBox(0.3, 0.42, 21, 0.16, 0.16, 3, shade(WHITE, t.outline));
  },

  wardrobe(pc, t) {
    const wood = shade(t.wood, t.outline, mix(t.wood, WHITE, 0.35));
    pc.isoBox(0, 0, 0, 1.5, 0.75, 70, wood);
    pc.isoBox(0, 0, 70, 1.5, 0.75, 3, shade(mix(t.wood, WHITE, 0.2), t.outline, WHITE)); // crown
    const front = (u0: number, u1: number, z0: number, z1: number, c: number) => pc.planeRect('y', 0.75, u0, u1, z0, z1, c);
    const panel = mix(t.wood, WHITE, 0.18);
    const groove = mix(t.wood, 0x000000, 0.3);
    front(0.02, 1.48, 1, 4, groove); // plinth shadow
    front(0.74, 0.77, 4, 69, groove); // gap between the doors
    for (const [u0, u1] of [[0.12, 0.66], [0.85, 1.39]] as const) {
      front(u0, u1, 10, 64, panel);
      front(u0, u1, 10, 11, groove); // inset: lower edge in shadow
      front(u1 - 0.03, u1, 10, 64, groove);
    }
    front(0.62, 0.68, 34, 41, t.outline); // handles
    front(0.83, 0.89, 34, 41, t.outline);
    front(0.02, 0.05, 4, 69, mix(t.wood, WHITE, 0.3)); // lit near edge
  },

  round_table(pc, t) {
    const top = shade(mix(t.wood, WHITE, 0.3), t.outline, WHITE);
    const leg = shade(mix(t.wood, 0x000000, 0.1), t.outline);
    pc.heightField(0.1, 0.1, 0.9, 0.9, 0, 3, (X, Y) => disk(X, Y, 0.5, 0.5, 0.3, 2), leg); // foot
    pc.isoBox(0.44, 0.44, 2, 0.12, 0.12, 16, leg); // pedestal
    pc.heightField(0, 0, 1, 1, 18, 4, (X, Y) => disk(X, Y, 0.5, 0.5, 0.5, 3), top);
    const doily = mix(t.fabric, WHITE, 0.5);
    // Round doily lying on the top.
    pc.heightField(0.1, 0.1, 0.9, 0.9, 21, 1, (X, Y) => disk(X, Y, 0.5, 0.5, 0.33, 0.5), { top: doily, left: doily, right: doily, outline: mix(t.fabric, WHITE, 0.15) });
    // A plate with a cookie and a mug (short and wide so they don't read as candles).
    pc.heightField(0.2, 0.2, 0.6, 0.6, 21, 2, (X, Y) => disk(X, Y, 0.4, 0.42, 0.15, 1), shade(WHITE, t.outline));
    pc.heightField(0.3, 0.3, 0.5, 0.52, 22, 2, (X, Y) => disk(X, Y, 0.4, 0.42, 0.07, 1.5), shade(0xe8b878, t.outline));
    const mug = shade(mix(t.accent, WHITE, 0.55), t.outline, WHITE);
    pc.heightField(0.5, 0.5, 0.78, 0.78, 21, 6, (X, Y) => disk(X, Y, 0.64, 0.62, 0.1, 5), mug);
    const handle = pc.at(0.74, 0.7, 24);
    pc.stamp(handle.x, handle.y - 1, ['kk', '.k', 'kk'], { k: t.outline });
  },

  beanbag(pc, t) {
    // A squashy bag: low dome with a raised back (-y) lump and a seat dip.
    const base = mix(t.accent, WHITE, 0.25);
    pc.heightField(0, 0, 1, 1, 0, 17, (X, Y) => {
      const body = dome(X, Y, 0.5, 0.54, 0.48, 0.44, 11);
      const back = dome(X, Y, 0.5, 0.3, 0.46, 0.3, 16);
      const dip = Math.max(0, 1 - Math.hypot(X - 0.52, Y - 0.6) / 0.26) * 3;
      return Math.max(body - dip, back);
    }, shade(base, t.outline, mix(base, WHITE, 0.45)));
  },

  mirror(pc, t) {
    // Full-length mirror leaning on the back wall, glass facing +y.
    const wood = shade(t.wood, t.outline, mix(t.wood, WHITE, 0.35));
    pc.isoBox(0.08, 0.26, 0, 0.6, 0.18, 3, shade(mix(t.wood, 0x000000, 0.1), t.outline)); // foot
    pc.isoBox(0.06, 0.12, 0, 0.64, 0.12, 60, wood); // frame
    pc.isoBox(0.16, 0.12, 60, 0.44, 0.12, 2, wood); // rounded top
    const glass = mix(t.windowSky, WHITE, 0.45);
    pc.planeRect('y', 0.24, 0.13, 0.63, 5, 57, glass);
    pc.planeRect('y', 0.24, 0.22, 0.54, 57, 59, glass);
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 12; i++) {
        const u = 0.2 + k * 0.18 + i * 0.02;
        pc.planeRect('y', 0.24, u, u + 0.04, 18 + i * 3, 21 + i * 3, mix(glass, WHITE, 0.6));
      }
    }
  },


  rug(pc, t) {
    pc.isoBox(0, 0, 0, 3, 2.5, 1, { top: t.rug, left: t.rugEdge, right: t.rugEdge, outline: t.rugEdge });
    pc.floorRect(0.15, 0.15, 2.85, 2.35, 1, t.rugEdge);
    pc.floorRect(0.22, 0.22, 2.78, 2.28, 1, t.rug);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 5; j++) {
        if ((i + j) % 2 === 0) pc.floorRect(0.45 + i * 0.4, 0.4 + j * 0.38, 0.55 + i * 0.4, 0.48 + j * 0.38, 1, t.rugEdge);
      }
    }
  },
};

const LEAVES = [
  '.......kk.........',
  '......kGGk...kk...',
  '...kk.kGgk..kGgk..',
  '..kGgkkggk.kGggk..',
  '..kggggggdkkgggk..',
  '...kggdgggkggdk...',
  '.kkkkggdggggdgkkk.',
  'kGGgggkdgggddgGGgk',
  'kgggdgggkgdggggggk',
  '.kgggddgggkdggdgk.',
  '..kkggggdggggdkk..',
  '.kGgkkgggdggkkgGk.',
  'kGgggggkggkgggggk.',
  'kggdggggkkggddgggk',
  '.kgggdggggggggggk.',
  '..kkgggdgggggdkk..',
  '...kggkkgdgkkggk..',
  '..kGgggggkgggggk..',
  '..kgggdggkggdgk...',
  '...kkggggdgggkk...',
  '.....kkgggggkk....',
  '.......kkdkk......',
  '........kdk.......',
  '........kdk.......',
  '........kdk.......',
  '.......kkdkk......',
  '........kkk.......',
  '..................',
];

export function furnitureTextureKey(id: FurnitureId, theme: RoomTheme, facing: Facing = 0): string {
  return `furniture:${id}:${theme.id}:${facing}`;
}

export function drawFurniture(id: FurnitureId, theme: RoomTheme, facing: Facing = 0): HTMLCanvasElement {
  const f = spriteFrame(FURNITURE[id], facing);
  const pc = new PixelCanvas(f.width, f.height, f.anchorX, f.anchorY);
  ART[id](facing === 0 ? pc : new AxisSwap(pc), theme);
  return pc.toCanvas();
}
