/**
 * Where speech bubbles go when several people talk at once (screen px).
 *
 * Each bubble wants to sit right above its speaker's name tag. Bubbles are
 * placed oldest first, so one already on screen keeps its spot and a newer
 * one moves around it: first a small slide sideways (its tail still over the
 * speaker), else up above the bubbles in the way. A bubble that can't fit in
 * the view without covering another is collapsed to a small marker rather
 * than pushed off screen. Pure: no DOM, no Phaser.
 */

export interface BubbleWant {
  id: string;
  /** Point the tail aims at (top of the speaker's name tag). */
  anchorX: number;
  anchorY: number;
  width: number;
  height: number;
  /** When it appeared: older bubbles are placed first and keep their spot. */
  order: number;
}

export interface BubbleSpot {
  x: number;
  y: number;
  /** Raised above other bubbles: drawn with a line down to the speaker. */
  lifted: boolean;
  /** No room: shown as a small marker over the speaker instead. */
  collapsed: boolean;
}

export interface BubbleArea {
  width: number;
  height: number;
  /** Space kept from the view's edges. */
  margin: number;
  /** Space between the box and the anchor (the tail). */
  tail: number;
  /** Space kept between two bubbles. */
  gap: number;
  /** How far the tail may sit from a box edge. */
  tailInset: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

export function layoutBubbles(wants: readonly BubbleWant[], area: BubbleArea): Map<string, BubbleSpot> {
  const out = new Map<string, BubbleSpot>();
  const placed: Rect[] = [];
  const { margin, gap } = area;
  const clampX = (x: number, w: number) => Math.min(Math.max(x, margin), Math.max(margin, area.width - margin - w));
  const fits = (r: Rect) => r.y >= margin - 0.5 && r.y + r.h <= area.height - margin + 0.5;
  const free = (r: Rect) => !placed.some((p) => overlaps(r, p, gap));

  for (const b of [...wants].sort((p, q) => p.order - q.order || p.id.localeCompare(q.id))) {
    const w = b.width;
    const h = b.height;
    const baseX = clampX(b.anchorX - w / 2, w);
    // Right above the anchor; pushed down into view near the top edge (the tail then hides).
    const baseY = Math.min(Math.max(b.anchorY - area.tail - h, margin), area.height - margin - h);
    // The tail must stay over the speaker: limits how far a bubble may slide.
    const tailOk = (x: number) => b.anchorX >= x + area.tailInset - 0.5 && b.anchorX <= x + w - area.tailInset + 0.5;

    const tries: Rect[] = [{ x: baseX, y: baseY, w, h }];
    for (const p of placed) {
      if (!overlaps({ x: baseX, y: baseY, w, h }, p, gap)) continue;
      for (const x of [p.x - gap - w, p.x + p.w + gap]) {
        const cx = clampX(x, w);
        if (tailOk(cx)) tries.push({ x: cx, y: baseY, w, h });
      }
    }
    // Then stack upwards, just above whatever is in the way.
    let y = baseY;
    for (let i = 0; i < placed.length; i++) {
      const block = placed.filter((p) => overlaps({ x: baseX, y, w, h }, p, gap));
      if (!block.length) break;
      y = Math.min(...block.map((p) => p.y)) - gap - h;
      tries.push({ x: baseX, y, w, h });
    }

    const spot = tries.find((r) => fits(r) && free(r));
    if (!spot) {
      out.set(b.id, { x: baseX, y: baseY, lifted: false, collapsed: true });
      continue;
    }
    placed.push(spot);
    out.set(b.id, { x: spot.x, y: spot.y, lifted: spot.y < baseY - 0.5, collapsed: false });
  }
  return out;
}

/**
 * Eases a bubble's offset from its natural spot (sideways slide or lift)
 * towards the new one, so bubbles glide instead of jumping when the layout
 * changes. `dtMs` since the last frame; settles within ~0.2 s.
 */
export function easeOffset(current: number, target: number, dtMs: number): number {
  const next = current + (target - current) * (1 - Math.exp(-dtMs / 70));
  return Math.abs(target - next) < 0.5 ? target : next;
}
