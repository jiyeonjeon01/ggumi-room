/**
 * Edit session for a room's furniture. Every change is checked with
 * validateLayout and only kept if the layout stays valid, so the layout is
 * always savable. Nothing here touches the server: the session starts from
 * the saved layout, `items` is the draft, `cancel` restores the original.
 * Removing a piece only takes it out of this room; the free catalog can add
 * it back any time.
 */
import type { Vec2 } from './iso';
import {
  findSpot,
  footprint,
  GRID,
  ROOM_H,
  ROOM_W,
  size,
  snap,
  validateLayout,
  type FurnitureType,
  type LayoutError,
  type LayoutItem,
} from './placement';

export interface EditItem extends LayoutItem {
  /** Stable id for this edit session (selection, sprites). Not stored on the server. */
  uid: string;
}

export type EditResult = { ok: true } | { ok: false; error: LayoutError };

let nextUid = 1;
const withUid = (it: LayoutItem): EditItem => ({ ...it, uid: `item-${nextUid++}` });
const same = (a: readonly LayoutItem[], b: readonly LayoutItem[]) =>
  a.length === b.length && a.every((x, i) => x.type === b[i]?.type && x.x === b[i]?.x && x.y === b[i]?.y && x.facing === b[i]?.facing);

export class LayoutEditor {
  private readonly original: readonly EditItem[];
  private current: readonly EditItem[];
  private readonly history: (readonly EditItem[])[] = [];
  private selectedUid: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    initial: readonly LayoutItem[],
    /** Where the character stands; furniture can't be put on it. */
    private readonly player?: Vec2,
  ) {
    this.original = initial.map(withUid);
    this.current = this.original;
  }

  get items(): readonly EditItem[] {
    return this.current;
  }

  get selected(): EditItem | null {
    return this.current.find((i) => i.uid === this.selectedUid) ?? null;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /** True when the draft differs from the saved layout. */
  get dirty(): boolean {
    return !same(this.current, this.original);
  }

  /** The draft without session ids, in a stable order, ready to save. */
  layout(): LayoutItem[] {
    return this.current.map(({ type, x, y, facing }) => ({ type, x, y, facing }));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  select(uid: string | null): void {
    if (uid === this.selectedUid) return;
    this.selectedUid = uid && this.current.some((i) => i.uid === uid) ? uid : null;
    this.emit();
  }

  /** Would moving `uid` to (x, y) be valid? (for drag previews; changes nothing) */
  check(uid: string, x: number, y: number): LayoutError | null {
    return validateLayout(this.replaced(uid, { x: snap(x), y: snap(y) }), this.player);
  }

  move(uid: string, x: number, y: number): EditResult {
    const item = this.find(uid);
    if (!item) return { ok: true };
    const nx = snap(x);
    const ny = snap(y);
    if (nx === item.x && ny === item.y) return { ok: true };
    return this.commit(this.replaced(uid, { x: nx, y: ny }));
  }

  /** Moves by whole grid steps along the world axes (keyboard arrows / touch pad). */
  nudge(uid: string, dx: number, dy: number): EditResult {
    const item = this.find(uid);
    return item ? this.move(uid, item.x + dx * GRID, item.y + dy * GRID) : { ok: true };
  }

  /**
   * Turns the piece to its other facing, keeping its center where it was
   * (snapped), and pulled back inside the room if the new shape sticks out.
   */
  rotate(uid: string): EditResult {
    const item = this.find(uid);
    if (!item) return { ok: true };
    const facing = item.facing === 0 ? 1 : 0;
    const old = footprint(item);
    const { w, h } = size(item.type, facing);
    const x = Math.min(Math.max(0, snap(old.x + old.w / 2 - w / 2)), ROOM_W - w);
    const y = Math.min(Math.max(0, snap(old.y + old.h / 2 - h / 2)), ROOM_H - h);
    return this.commit(this.replaced(uid, { facing, x, y }));
  }

  /** Adds a piece from the catalog at the free spot closest to `near`, and selects it. */
  add(type: FurnitureType, near?: Vec2): EditResult {
    const spot = findSpot(this.current, type, 0, this.player, near) ?? findSpot(this.current, type, 1, this.player, near);
    if (!spot) return { ok: false, error: validateLayout([...this.current, { type, x: 0, y: 0, facing: 0 }]) ?? { code: 'overlap' } };
    const item = withUid(spot);
    const result = this.commit([...this.current, item]);
    if (result.ok) this.select(item.uid);
    return result;
  }

  remove(uid: string): EditResult {
    if (!this.find(uid)) return { ok: true };
    if (this.selectedUid === uid) this.selectedUid = null;
    return this.commit(this.current.filter((i) => i.uid !== uid));
  }

  undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.current = prev;
    if (this.selectedUid && !prev.some((i) => i.uid === this.selectedUid)) this.selectedUid = null;
    this.emit();
  }

  /** Back to the saved layout (Cancel). */
  cancel(): void {
    this.current = this.original;
    this.history.length = 0;
    this.selectedUid = null;
    this.emit();
  }

  private find(uid: string): EditItem | undefined {
    return this.current.find((i) => i.uid === uid);
  }

  private replaced(uid: string, patch: Partial<LayoutItem>): EditItem[] {
    return this.current.map((i) => (i.uid === uid ? { ...i, ...patch } : i));
  }

  private commit(next: EditItem[]): EditResult {
    const error = validateLayout(next, this.player);
    if (error) return { ok: false, error };
    this.history.push(this.current);
    this.current = next;
    this.emit();
    return { ok: true };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
