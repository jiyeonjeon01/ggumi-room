import type { ScreenPlacement } from '../art/lampArt';

/**
 * Furniture catalog: gameplay data only (size, collision). Art lives in
 * art/furnitureArt.ts and is looked up by `id`.
 *
 * Sprite convention (also for future hand-made PNGs) — see spriteFrame():
 * the image is (w + h) * 16 + 2 px wide and (w + h) * 8 + height + 2 px tall,
 * and the floor point under the footprint's back corner (x, y) sits at
 * pixel (h * 16 + 1, height + 1).
 */
export type FurnitureId = 'bed' | 'desk' | 'bookshelf' | 'nightstand' | 'plant' | 'table' | 'cushion' | 'rug';

export interface FurnitureDef {
  id: FurnitureId;
  name: string;
  /** Footprint in world tiles: w along +x, h along +y. */
  w: number;
  h: number;
  /** Tallest point of the art above the floor, in pixels. */
  height: number;
  /** Blocks movement. Non-blocking items (rugs) are drawn on the floor layer. */
  blocking: boolean;
  /** Light source (lamp bulb) in local world tiles / pixel height, if any. */
  light?: { x: number; y: number; z: number };
  /** A glowing screen (local world tiles / pixel heights), if any. */
  screen?: ScreenPlacement;
}

export const FURNITURE: Record<FurnitureId, FurnitureDef> = {
  bed: { id: 'bed', name: '침대', w: 3, h: 2, height: 34, blocking: true },
  desk: {
    id: 'desk',
    name: '책상',
    w: 2,
    h: 1,
    height: 44,
    blocking: true,
    // Matches the monitor in furnitureArt (glass on y = 0.2, desk top at z = 26).
    screen: { x0: 0.68, x1: 1.42, y: 0.2, z0: 32, z1: 42, surfaceZ: 26, surfaceDepth: 0.7 },
  },
  bookshelf: { id: 'bookshelf', name: '책장', w: 1.5, h: 0.75, height: 64, blocking: true },
  nightstand: {
    id: 'nightstand',
    name: '협탁',
    w: 0.75,
    h: 0.75,
    height: 38,
    blocking: true,
    light: { x: 0.37, y: 0.37, z: 31 },
  },
  plant: { id: 'plant', name: '화분', w: 0.75, h: 0.75, height: 40, blocking: true },
  table: { id: 'table', name: '좌식 테이블', w: 1.25, h: 1.25, height: 22, blocking: true },
  cushion: { id: 'cushion', name: '방석', w: 0.75, h: 0.75, height: 8, blocking: false },
  rug: { id: 'rug', name: '러그', w: 3, h: 2.5, height: 2, blocking: false },
};

export interface SpriteFrame {
  width: number;
  height: number;
  /** Pixel where the footprint's back corner (on the floor) lies. */
  anchorX: number;
  anchorY: number;
}

export function spriteFrame(def: FurnitureDef): SpriteFrame {
  return {
    width: Math.ceil((def.w + def.h) * 16) + 2,
    height: Math.ceil((def.w + def.h) * 8) + def.height + 2,
    anchorX: Math.round(def.h * 16) + 1,
    anchorY: def.height + 1,
  };
}
