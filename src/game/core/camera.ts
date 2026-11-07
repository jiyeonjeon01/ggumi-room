import { FLOOR_THICKNESS, WALL_HEIGHT, WALL_THICKNESS } from '../art/roomArt';
import { TILE_H, TILE_W } from './iso';

/** A room's drawing on screen (world px), walls and floor edge included. */
export interface Extent {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function roomExtent(width: number, height: number): Extent {
  const T = WALL_THICKNESS;
  return {
    left: -(height + T) * (TILE_W / 2),
    right: (width + T) * (TILE_W / 2),
    top: -WALL_HEIGHT - T * TILE_H - 4,
    bottom: (width + height) * (TILE_H / 2) + FLOOR_THICKNESS,
  };
}

/** Space kept around a whole room shown at once (CSS px). */
const FIT_MARGIN = 24;

/**
 * Zoom that shows the whole room: the largest whole number that fits (crisp
 * pixels), or a fraction on tiny screens.
 */
export function fitZoom(viewW: number, viewH: number, e: Extent): number {
  const fit = Math.min((viewW - FIT_MARGIN * 2) / (e.right - e.left), (viewH - FIT_MARGIN * 2) / (e.bottom - e.top));
  return fit >= 1 ? Math.floor(fit) : Math.max(0.25, fit);
}

/** Personal rooms are 9 x 8: a big room is shown as large as one of these would be. */
const REFERENCE = roomExtent(9, 8);
/** A following camera never zooms in so far that less than this much room (world px) shows vertically. */
const MIN_VISIBLE_H = 140;

/**
 * Zoom for a room bigger than the screen (party lounge), explored with a
 * following camera: the same whole-number zoom a personal room gets here, so
 * furniture and characters look the same size, but at least 2x (phones would
 * otherwise shrink the room to a fraction), and not so close that only a sliver
 * of the room fits (short landscape phones).
 */
export function followZoom(viewW: number, viewH: number): number {
  const personal = Math.floor(fitZoom(viewW, viewH, REFERENCE));
  const cap = Math.max(1, Math.floor(viewH / MIN_VISIBLE_H));
  return Math.min(Math.max(personal, 2), cap);
}

/** Space around a followed room's drawing the camera may still show (world px). */
const EDGE = 12;

/**
 * Where the view's centre may go on one axis: inside the room's drawing (plus
 * a little edge), or the middle if the view is wider than the room.
 */
export function centreRange(min: number, max: number, view: number): [number, number] {
  const lo = min - EDGE + view / 2;
  const hi = max + EDGE - view / 2;
  if (lo > hi) {
    const mid = (min + max) / 2;
    return [mid, mid];
  }
  return [lo, hi];
}

/** Share of the view (each axis) the character can walk in before the camera moves. */
export const DEADZONE = 0.2;
/** How quickly the camera catches up (per second); lower is calmer. */
const CATCH_UP = 6;

/**
 * One axis of the following camera: the view centre stays put while the
 * character is inside the dead zone, then eases towards keeping it at the
 * zone's edge, and never leaves `range`. `dt` in seconds; 0 snaps.
 */
export function followAxis(centre: number, target: number, view: number, range: [number, number], dt: number): number {
  const half = (view * DEADZONE) / 2;
  let want = centre;
  if (target < centre - half) want = target + half;
  else if (target > centre + half) want = target - half;
  want = Math.min(Math.max(want, range[0]), range[1]);
  const next = dt <= 0 ? want : centre + (want - centre) * (1 - Math.exp(-CATCH_UP * dt));
  // Snap the last fraction so the camera comes to rest instead of creeping forever.
  return Math.abs(want - next) < 0.05 ? want : Math.min(Math.max(next, range[0]), range[1]);
}
