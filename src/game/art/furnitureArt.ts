import { FURNITURE, spriteFrame, type FurnitureId } from '../room/furniture';
import { mix, PixelCanvas, shade } from './pixelCanvas';
import type { RoomTheme } from './themes';

/**
 * Placeholder furniture art, built from iso boxes and small hand-placed
 * details. Each function draws in the furniture's local world frame where
 * (0,0,0) is the back corner of its footprint on the floor.
 * Replace with real sprites by loading PNGs under the same texture keys and
 * following the sprite convention in room/furniture.ts.
 */
type Draw = (pc: PixelCanvas, t: RoomTheme) => void;

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

export function furnitureTextureKey(id: FurnitureId, theme: RoomTheme): string {
  return `furniture:${id}:${theme.id}`;
}

export function drawFurniture(id: FurnitureId, theme: RoomTheme): HTMLCanvasElement {
  const f = spriteFrame(FURNITURE[id]);
  const pc = new PixelCanvas(f.width, f.height, f.anchorX, f.anchorY);
  ART[id](pc, theme);
  return pc.toCanvas();
}
