/**
 * Furniture layout rules: footprints, rotation, snapping and validation.
 * Pure logic shared by the editor and tests; api/app/layout.py implements the
 * same rules on the server (both run shared/layout-cases.json).
 */
import catalog from '../../../shared/furniture.json';
import { circleIntersectsRect, type Rect } from './collision';
import type { Vec2 } from './iso';

export type Facing = 0 | 1;
export type FurnitureType = keyof typeof catalog.items;

export interface LayoutItem {
  type: FurnitureType;
  x: number;
  y: number;
  facing: Facing;
}

export const ROOM_W = catalog.room.width;
export const ROOM_H = catalog.room.height;
export const GRID = catalog.grid;
export const MAX_ITEMS = catalog.maxItems;
export const PLAYER_RADIUS = catalog.playerRadius;
export const MAX_POCKET_CELLS = catalog.maxPocketCells;
export const FURNITURE_TYPES = Object.keys(catalog.items) as FurnitureType[];
export const DEFAULT_LAYOUT: readonly LayoutItem[] = catalog.defaultLayout.map((i) => ({
  type: i.type as FurnitureType,
  x: i.x,
  y: i.y,
  facing: i.facing as Facing,
}));

export function isFurnitureType(t: string): t is FurnitureType {
  return Object.hasOwn(catalog.items, t);
}

export function catalogEntry(type: FurnitureType): { name: string; w: number; h: number; blocking: boolean } {
  return catalog.items[type];
}

/** Footprint size for a facing: facing 1 is the same piece turned 90 degrees (w and h swap). */
export function size(type: FurnitureType, facing: Facing): { w: number; h: number } {
  const { w, h } = catalogEntry(type);
  return facing === 0 ? { w, h } : { w: h, h: w };
}

export function footprint(item: LayoutItem): Rect {
  return { x: item.x, y: item.y, ...size(item.type, item.facing) };
}

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

const onGrid = (v: number) => Math.abs(v / GRID - Math.round(v / GRID)) < 1e-9;

const EPS = 1e-9;
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

export type LayoutErrorCode =
  | 'too_many'
  | 'unknown_type'
  | 'bad_facing'
  | 'off_grid'
  | 'out_of_bounds'
  | 'overlap'
  | 'on_player'
  | 'blocked_path';

export interface LayoutError {
  code: LayoutErrorCode;
  /** Index into the items array, when one item is at fault. */
  index?: number;
}

export const LAYOUT_ERROR_TEXT: Record<LayoutErrorCode, string> = {
  too_many: `가구는 ${MAX_ITEMS}개까지 놓을 수 있어요.`,
  unknown_type: '알 수 없는 가구가 있어요.',
  bad_facing: '가구 방향이 올바르지 않아요.',
  off_grid: '가구는 칸에 맞춰 놓아야 해요.',
  out_of_bounds: '방 밖으로는 놓을 수 없어요.',
  overlap: '다른 가구와 겹쳐요.',
  on_player: '캐릭터가 서 있는 자리예요.',
  blocked_path: '이렇게 놓으면 갈 수 없는 곳이 생겨요.',
};

const COLS = Math.round(ROOM_W / GRID);
const ROWS = Math.round(ROOM_H / GRID);
const cellOf = (p: Vec2) => Math.min(ROWS - 1, Math.max(0, Math.floor(p.y / GRID))) * COLS + Math.min(COLS - 1, Math.max(0, Math.floor(p.x / GRID)));

/**
 * Splits the walkable floor (same 0.25-tile grid and body size as the game's
 * NavGrid) into connected areas. Returns the area id per cell (-1 = blocked)
 * and the id of the largest area.
 */
function floorAreas(blocking: readonly Rect[]): { area: Int32Array; sizes: number[]; main: number } {
  const r = PLAYER_RADIUS;
  const area = new Int32Array(COLS * ROWS).fill(-2); // -2 walkable unvisited, -1 blocked
  for (let row = 0; row < ROWS; row++) {
    for (let c = 0; c < COLS; c++) {
      const x = (c + 0.5) * GRID;
      const y = (row + 0.5) * GRID;
      const free = !(x - r < 0 || y - r < 0 || x + r > ROOM_W || y + r > ROOM_H) && !blocking.some((b) => circleIntersectsRect(x, y, r, b));
      area[row * COLS + c] = free ? -2 : -1;
    }
  }
  const sizes: number[] = [];
  for (let i = 0; i < area.length; i++) {
    if (area[i] !== -2) continue;
    const id = sizes.length;
    let count = 0;
    const stack = [i];
    area[i] = id;
    while (stack.length) {
      const j = stack.pop() as number;
      count++;
      const c = j % COLS;
      const row = (j - c) / COLS;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc;
        const nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const k = nr * COLS + nc;
        if (area[k] === -2) {
          area[k] = id;
          stack.push(k);
        }
      }
    }
    sizes.push(count);
  }
  let main = -1;
  sizes.forEach((n, id) => {
    if (main < 0 || n > (sizes[main] ?? 0)) main = id;
  });
  return { area, sizes, main };
}

/**
 * Furniture may leave tiny dead corners, but must not wall off any real part
 * of the floor: every area cut off from the main one must be smaller than
 * MAX_POCKET_CELLS + 1 cells. With `player`, their spot must stay in the main area.
 */
export function pathsConnected(blocking: readonly Rect[], player?: Vec2): boolean {
  const { area, sizes, main } = floorAreas(blocking);
  if (main < 0) return false;
  if (sizes.some((n, id) => id !== main && n > MAX_POCKET_CELLS)) return false;
  if (!player) return true;
  // The player may stand closer to furniture than a cell center allows, so
  // also accept a main-area cell right next to theirs.
  const center = cellOf(player);
  const c = center % COLS;
  const row = (center - c) / COLS;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nc = c + dc;
      const nr = row + dr;
      if (nc >= 0 && nr >= 0 && nc < COLS && nr < ROWS && area[nr * COLS + nc] === main) return true;
    }
  }
  return false;
}

/**
 * Checks a whole layout. Returns the first problem found (in a fixed order,
 * matching the server), or null. `player` (editor only) keeps furniture off
 * the spot where the character stands.
 */
export function validateLayout(items: readonly { type: string; x: number; y: number; facing: number }[], player?: Vec2): LayoutError | null {
  if (items.length > MAX_ITEMS) return { code: 'too_many' };
  const rects: Rect[] = [];
  const blocking: Rect[] = [];
  for (const [index, it] of items.entries()) {
    if (!isFurnitureType(it.type)) return { code: 'unknown_type', index };
    if (it.facing !== 0 && it.facing !== 1) return { code: 'bad_facing', index };
    if (!onGrid(it.x) || !onGrid(it.y)) return { code: 'off_grid', index };
    const rect = footprint(it as LayoutItem);
    if (rect.x < -EPS || rect.y < -EPS || rect.x + rect.w > ROOM_W + EPS || rect.y + rect.h > ROOM_H + EPS) {
      return { code: 'out_of_bounds', index };
    }
    rects.push(rect);
    if (catalogEntry(it.type).blocking) {
      if (blocking.some((b) => overlaps(b, rect))) return { code: 'overlap', index };
      if (player && circleIntersectsRect(player.x, player.y, PLAYER_RADIUS, rect)) return { code: 'on_player', index };
      blocking.push(rect);
    }
  }
  if (!pathsConnected(blocking, player)) return { code: 'blocked_path' };
  return null;
}

/**
 * Where a newly added piece goes: the free spot closest to `near` (default:
 * room center) that keeps the layout valid, or null if there is none.
 */
export function findSpot(items: readonly LayoutItem[], type: FurnitureType, facing: Facing, player?: Vec2, near?: Vec2): LayoutItem | null {
  const { w, h } = size(type, facing);
  const target = near ?? { x: ROOM_W / 2, y: ROOM_H / 2 };
  const spots: { x: number; y: number; d: number }[] = [];
  for (let x = 0; x + w <= ROOM_W + EPS; x += GRID) {
    for (let y = 0; y + h <= ROOM_H + EPS; y += GRID) {
      spots.push({ x, y, d: Math.hypot(x + w / 2 - target.x, y + h / 2 - target.y) });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  for (const s of spots) {
    const candidate: LayoutItem = { type, x: s.x, y: s.y, facing };
    if (!validateLayout([...items, candidate], player)) return candidate;
  }
  return null;
}
