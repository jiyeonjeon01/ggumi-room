import type { ScreenPlacement } from '../art/lampArt';
import { catalogEntry, FURNITURE_TYPES, size, type Facing, type FurnitureType } from '../core/placement';

/**
 * Furniture definitions for rendering. Footprint size, name and collision
 * come from the shared catalog (shared/furniture.json, also used by the API);
 * this adds what only the renderer needs: art height and light sources.
 *
 * Every piece has two facings. Facing 0 is the drawn orientation; facing 1 is
 * the same piece turned 90 degrees: footprint w/h swap and the art is redrawn
 * with world x and y swapped (not mirrored), so lit and shaded faces stay
 * where the light comes from.
 *
 * Sprite convention (also for future hand-made PNGs) — see spriteFrame():
 * the image is (w + h) * 16 + 2 px wide and (w + h) * 8 + height + 2 px tall,
 * and the floor point under the footprint's back corner (x, y) sits at
 * pixel (h * 16 + 1, height + 1), using the footprint for that facing.
 */
export type FurnitureId = FurnitureType;

export interface FurnitureDef {
  id: FurnitureId;
  name: string;
  /** Footprint in world tiles for facing 0: w along +x, h along +y. */
  w: number;
  h: number;
  /** Tallest point of the art above the floor, in pixels. */
  height: number;
  /** Blocks movement. Non-blocking items (rugs) are drawn on the floor layer. */
  blocking: boolean;
  /** Light source (lamp bulb) in local world tiles / pixel height, facing 0. */
  light?: { x: number; y: number; z: number };
  /** A glowing screen (local coordinates, facing 0). */
  screen?: ScreenPlacement;
}

const RENDER: Record<FurnitureId, Pick<FurnitureDef, 'height' | 'light' | 'screen'>> = {
  bed: { height: 34 },
  // Matches the monitor in furnitureArt (glass on y = 0.2, desk top at z = 26).
  desk: { height: 44, screen: { axis: 'y', u0: 0.68, u1: 1.42, v: 0.2, z0: 32, z1: 42, surfaceZ: 26, surfaceDepth: 0.7 } },
  chair: { height: 30 },
  bookshelf: { height: 64 },
  nightstand: { height: 38, light: { x: 0.37, y: 0.37, z: 31 } },
  plant: { height: 40 },
  table: { height: 22 },
  cushion: { height: 8 },
  sofa: { height: 26 },
  vanity: { height: 54 },
  wardrobe: { height: 75 },
  round_table: { height: 28 },
  beanbag: { height: 19 },
  mirror: { height: 64 },
  rug: { height: 2 },
};

export const FURNITURE: Record<FurnitureId, FurnitureDef> = Object.fromEntries(
  FURNITURE_TYPES.map((id) => {
    const c = catalogEntry(id);
    return [id, { id, name: c.name, w: c.w, h: c.h, blocking: c.blocking, ...RENDER[id] }];
  }),
) as Record<FurnitureId, FurnitureDef>;

export interface SpriteFrame {
  width: number;
  height: number;
  /** Pixel where the footprint's back corner (on the floor) lies. */
  anchorX: number;
  anchorY: number;
}

export function spriteFrame(def: FurnitureDef, facing: Facing = 0): SpriteFrame {
  const { w, h } = size(def.id, facing);
  return {
    width: Math.ceil((w + h) * 16) + 2,
    height: Math.ceil((w + h) * 8) + def.height + 2,
    anchorX: Math.round(h * 16) + 1,
    anchorY: def.height + 1,
  };
}

/** A lamp's bulb in room coordinates for a placed piece. */
export function lightOf(def: FurnitureDef, x: number, y: number, facing: Facing) {
  const l = def.light;
  if (!l) return null;
  return facing === 0 ? { x: x + l.x, y: y + l.y, z: l.z } : { x: x + l.y, y: y + l.x, z: l.z };
}

/** A screen in room coordinates for a placed piece (facing 1 turns it onto the other wall axis). */
export function screenOf(def: FurnitureDef, x: number, y: number, facing: Facing): ScreenPlacement | null {
  const s = def.screen;
  if (!s) return null;
  if (facing === 0) return { ...s, u0: x + s.u0, u1: x + s.u1, v: y + s.v };
  return { ...s, axis: s.axis === 'y' ? 'x' : 'y', u0: y + s.u0, u1: y + s.u1, v: x + s.v };
}
