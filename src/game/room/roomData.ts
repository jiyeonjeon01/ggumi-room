import catalog from '../../../shared/furniture.json';
import type { WallDecor } from '../art/roomArt';
import type { ThemeId } from '../art/themes';
import type { Vec2 } from '../core/iso';
import { DEFAULT_LAYOUT, footprint, type Facing, type LayoutItem } from '../core/placement';
import { FURNITURE, type FurnitureId } from './furniture';

export interface FurniturePlacement {
  id: FurnitureId;
  /** Back corner of the footprint in world tiles. */
  x: number;
  y: number;
  /** 0 = as drawn, 1 = turned 90 degrees (footprint w/h swapped). */
  facing: Facing;
}

export const toPlacements = (items: readonly LayoutItem[]): FurniturePlacement[] =>
  items.map((i) => ({ id: i.type, x: i.x, y: i.y, facing: i.facing }));

export const toLayout = (placements: readonly FurniturePlacement[]): LayoutItem[] =>
  placements.map((p) => ({ type: p.id, x: p.x, y: p.y, facing: p.facing }));

/**
 * A window on one of the two back walls. `u0..u1` is the glass span along the
 * wall in tiles (x for the right wall, y for the left wall), `z0..z1` the
 * glass height above the floor in pixels. Frame and curtains go around it.
 */
export interface WindowPlacement {
  wall: 'left' | 'right';
  u0: number;
  u1: number;
  z0: number;
  z1: number;
}

/**
 * Serializable description of a room. This is the shape that will later be
 * saved per user (personal rooms) or shared (social room).
 */
export interface RoomData {
  id: string;
  name: string;
  owner: string;
  theme: ThemeId;
  /** Floor size in tiles (x, y). */
  width: number;
  height: number;
  spawn: Vec2;
  furniture: FurniturePlacement[];
  windows: WindowPlacement[];
  /** Wall decorations (personal room unless a template says otherwise). */
  decor?: WallDecor;
}

interface TemplateJson {
  name: string;
  width: number;
  height: number;
  spawn: Vec2;
  decor: WallDecor;
  windows: WindowPlacement[];
  layout: { type: string; x: number; y: number; facing: number }[];
}

/** A room built from a catalog template (shared/furniture.json "templates"), e.g. the party lounge. */
export function roomFromTemplate(name: 'lounge', base: Pick<RoomData, 'id' | 'name' | 'owner' | 'theme'>): RoomData {
  const t = (catalog as unknown as { templates: Record<string, TemplateJson> }).templates[name] as TemplateJson;
  return {
    ...base,
    width: t.width,
    height: t.height,
    spawn: { ...t.spawn },
    windows: t.windows.map((w) => ({ ...w })),
    decor: t.decor,
    furniture: t.layout.map((i) => ({ id: i.type as FurniturePlacement['id'], x: i.x, y: i.y, facing: i.facing as Facing })),
  };
}

export const DEMO_ROOM: RoomData = {
  id: 'demo',
  name: '꾸미의 방',
  owner: '꾸미',
  theme: 'pastel',
  width: 9,
  height: 8,
  spawn: { x: 7, y: 5.5 },
  // Same default every new room gets on the server (shared/furniture.json).
  furniture: toPlacements(DEFAULT_LAYOUT),
  windows: [{ wall: 'right', u0: 4.9, u1: 6.1, z0: 40, z1: 72 }],
};

/** Collision rectangles of all blocking furniture in a room. */
export function obstaclesOf(room: RoomData) {
  return room.furniture.filter((f) => FURNITURE[f.id].blocking).map((f) => footprint(toLayout([f])[0] as LayoutItem));
}
