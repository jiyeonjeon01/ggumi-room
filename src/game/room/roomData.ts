import type { ThemeId } from '../art/themes';
import type { Vec2 } from '../core/iso';
import { FURNITURE, type FurnitureId } from './furniture';

export interface FurniturePlacement {
  id: FurnitureId;
  /** Back corner of the footprint in world tiles. */
  x: number;
  y: number;
}

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
}

export const DEMO_ROOM: RoomData = {
  id: 'demo',
  name: '꾸미의 방',
  owner: '꾸미',
  theme: 'pastel',
  width: 9,
  height: 8,
  spawn: { x: 7, y: 5.5 },
  furniture: [
    { id: 'rug', x: 3.5, y: 3.75 },
    { id: 'bed', x: 0, y: 0.75 },
    { id: 'nightstand', x: 0, y: 2.9 },
    { id: 'bookshelf', x: 3.25, y: 0 },
    { id: 'desk', x: 6.25, y: 0 },
    { id: 'plant', x: 8.1, y: 1.2 },
    { id: 'plant', x: 0.15, y: 7.05 },
    { id: 'table', x: 4.4, y: 4.4 },
    { id: 'cushion', x: 4.6, y: 6 },
  ],
  windows: [{ wall: 'right', u0: 4.9, u1: 6.1, z0: 40, z1: 72 }],
};

/** Collision rectangles of all blocking furniture in a room. */
export function obstaclesOf(room: RoomData) {
  return room.furniture
    .filter((f) => FURNITURE[f.id].blocking)
    .map((f) => ({ x: f.x, y: f.y, w: FURNITURE[f.id].w, h: FURNITURE[f.id].h }));
}
