import { FONT_STACK as FONT } from '../art/fonts';
import type { Vec2 } from '../core/iso';
import { placeAt, TEXT_SIZE, textFont } from '../ui/TextOverlay';
import { easeOffset, type BubbleSpot } from './bubbleLayout';
import { layoutBubble } from './chat';

const PAD_X = 4;
const PAD_Y = 2;
/** Line height and the gap between lines, in world px (as the in-game text had). */
const LINE_H = 8;
const LINE_GAP = 1;
/** Text width limit in world px; about 12 Korean syllables, so 24 fit in 2 lines. */
const MAX_TEXT_W = 74;
/** World px: the tail's height, space kept from the view's edges and between bubbles. */
export const BUBBLE_TAIL = 3;
export const BUBBLE_MARGIN = 2;
export const BUBBLE_GAP = 2;
/** How far (world px) the tail may sit from the box's side. */
export const BUBBLE_TAIL_INSET = 4;
/** Over every name tag: bubbles are UI, never hidden by furniture or other people's tags. */
const Z = 100000;

const BG = '#fffaf3';
const BORDER = '#e9a8c4';
const TEXT = '#7a4a68';
const SVG_NS = 'http://www.w3.org/2000/svg';

let measureCtx: CanvasRenderingContext2D | null = null;
/** Width of a string in world px, measured large (fractional widths) with the font the bubble shows. */
function measure(s: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return s.length * TEXT_SIZE;
  measureCtx.font = `${TEXT_SIZE * 10}px ${FONT}`;
  return measureCtx.measureText(s).width / 10;
}

function svg(viewBox: string): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('shape-rendering', 'crispEdges');
  el.style.position = 'absolute';
  return el;
}

function rects(parent: SVGElement, fill: string, list: readonly (readonly [number, number, number, number])[]): void {
  for (const [x, y, w, h] of list) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(h));
    r.setAttribute('fill', fill);
    parent.appendChild(r);
  }
}

function div(layer: HTMLElement, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, { position: 'absolute', left: '0', top: '0', display: 'none', ...style });
  layer.appendChild(el);
  return el;
}

/** Shown order of bubbles (older first keep their spot when several overlap). */
let shownCount = 0;

/**
 * A pixel-art speech bubble that points at a character. Purely a view: local
 * and remote players' messages use the same bubble. Drawn in the page's text
 * layer (see TextOverlay) so its text is sharp on any screen; the box and the
 * stepped tail keep their pixel shapes (crisp-edged SVG). Where it goes is
 * decided for all bubbles together (see bubbleLayout): normally right above
 * the speaker; raised above another bubble it gets a thin line down to the
 * speaker; with no room left it shrinks to a small "…" marker.
 */
export class SpeechBubble {
  private readonly el: HTMLDivElement;
  private readonly box: SVGSVGElement;
  private readonly tail: SVGSVGElement;
  private readonly text: HTMLDivElement;
  /** Line from a raised bubble down to its speaker (under every bubble). */
  private readonly leader: HTMLDivElement;
  /** Small marker shown instead of the bubble when there's no room. */
  private readonly mini: HTMLDivElement;
  /** Size in world px. */
  private width = 0;
  private height = 0;
  private lines: string[] = [];
  private scale = 0;
  private shown = false;
  /** Offset of the box from its anchor (CSS px), eased between layouts; null = not placed yet. */
  private offset: Vec2 | null = null;
  private shownOrder = 0;
  /** Last placement, canvas CSS px. */
  private rect = { x: 0, y: 0, width: 0, height: 0, tailX: 0, tail: false, lifted: false, collapsed: false };

  constructor(layer: HTMLElement) {
    this.el = div(layer, { zIndex: String(Z) });
    this.el.dataset.bubble = '';
    this.box = svg('0 0 0 0');
    this.tail = svg(`-3 0 6 ${BUBBLE_TAIL}`);
    // Small stepped tail; its top row overlaps the box's bottom border. Origin = tip column.
    rects(this.tail, BG, [[-2, 0, 4, 1], [-1, 1, 2, 1]]);
    rects(this.tail, BORDER, [[-3, 0, 1, 1], [2, 0, 1, 1], [-2, 1, 1, 1], [1, 1, 1, 1], [-1, 2, 2, 1]]);
    this.text = document.createElement('div');
    Object.assign(this.text.style, { position: 'absolute', left: '0', color: TEXT, textAlign: 'center', whiteSpace: 'pre' });
    this.el.append(this.box, this.tail, this.text);
    this.leader = div(layer, { zIndex: String(Z - 1), background: BORDER });
    this.mini = div(layer, { zIndex: String(Z), background: BG, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: '3px', lineHeight: '1', whiteSpace: 'nowrap' });
    this.mini.dataset.bubbleMore = '';
    this.mini.textContent = '…';
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Current text (lines joined by '\n'); '' when hidden. */
  get content(): string {
    return this.shown ? this.lines.join('\n') : '';
  }

  /** When it appeared (older bubbles keep their spot). */
  get order(): number {
    return this.shownOrder;
  }

  /** Box and tail tip in canvas CSS px (for tests), the line count, raised / collapsed. */
  get bounds() {
    return { ...this.rect, lines: this.lines.length };
  }

  show(content: string): void {
    const { lines, width } = layoutBubble(content, MAX_TEXT_W, measure);
    this.lines = lines;
    this.text.textContent = lines.join('\n');
    this.width = Math.ceil(width) + PAD_X * 2;
    this.height = lines.length * LINE_H + (lines.length - 1) * LINE_GAP + PAD_Y * 2;
    this.drawBox();
    this.scale = 0; // re-apply sizes on the next place()
    this.offset = null;
    this.shownOrder = ++shownCount;
    this.shown = true;
    this.el.style.display = '';
  }

  hide(): void {
    this.shown = false;
    for (const el of [this.el, this.leader, this.mini]) el.style.display = 'none';
  }

  /** On-screen size of the box (CSS px) at this text scale. */
  size(scale: number): { width: number; height: number } {
    return { width: Math.round(this.width * scale), height: Math.round(this.height * scale) };
  }

  /**
   * Puts the bubble where the layout decided (`spot`, canvas CSS px) for a
   * speaker whose tail point is `anchor`. Moves between layouts are eased
   * (`dtMs` since the last frame) so bubbles glide instead of jumping; the
   * offset is kept relative to the speaker, so it never lags behind them.
   */
  place(spot: BubbleSpot, anchor: Vec2, scale: number, dtMs: number): void {
    if (!this.shown) return;
    const s = scale;
    const { width: w, height: h } = this.size(s);
    if (s !== this.scale) this.applyScale(s, w, h);
    const ax = Math.round(anchor.x);
    const ay = Math.round(anchor.y);

    if (spot.collapsed) {
      this.el.style.display = 'none';
      this.leader.style.display = 'none';
      this.mini.style.display = '';
      const mw = this.mini.offsetWidth;
      const mh = this.mini.offsetHeight;
      const x = Math.round(ax - mw / 2);
      const y = Math.round(ay - BUBBLE_TAIL * s - mh);
      placeAt(this.mini, x, y);
      this.offset = null; // reappears right where the layout puts it
      this.rect = { x, y, width: mw, height: mh, tailX: ax, tail: false, lifted: false, collapsed: true };
      return;
    }
    this.mini.style.display = 'none';
    this.el.style.display = '';
    const want = { x: spot.x - ax, y: spot.y - ay };
    const off = this.offset ? { x: easeOffset(this.offset.x, want.x, dtMs), y: easeOffset(this.offset.y, want.y, dtMs) } : want;
    this.offset = off;
    const left = Math.round(ax + off.x);
    const top = Math.round(ay + off.y);
    placeAt(this.el, left, top);

    const inset = BUBBLE_TAIL_INSET * s;
    const tx = Math.round(Math.min(Math.max(ax, left + inset), left + w - inset));
    // Tail when the box sits over its speaker; hidden if clamping pushed it down over them.
    const tail = top + h <= ay;
    this.tail.style.display = tail ? '' : 'none';
    this.tail.style.left = `${tx - left - 3 * s}px`;
    this.tail.style.top = `${h - s}px`;
    // Raised: a thin line from under the tail down to the speaker.
    const lineTop = top + h + BUBBLE_TAIL * s - s;
    if (spot.lifted && ay - lineTop > 2 * s) {
      this.leader.style.display = '';
      this.leader.style.width = `${Math.max(1, Math.round(s / 2))}px`;
      this.leader.style.height = `${Math.round(ay - lineTop)}px`;
      placeAt(this.leader, tx, lineTop);
    } else this.leader.style.display = 'none';
    this.rect = { x: left, y: top, width: w, height: h, tailX: tx, tail, lifted: spot.lifted, collapsed: false };
  }

  destroy(): void {
    for (const el of [this.el, this.leader, this.mini]) el.remove();
  }

  private applyScale(s: number, w: number, h: number): void {
    this.scale = s;
    this.box.setAttribute('width', String(w));
    this.box.setAttribute('height', String(h));
    this.tail.setAttribute('width', String(6 * s));
    this.tail.setAttribute('height', String(BUBBLE_TAIL * s));
    Object.assign(this.text.style, {
      font: textFont(s),
      lineHeight: `${(LINE_H + LINE_GAP) * s}px`,
      top: `${(PAD_Y - LINE_GAP / 2) * s}px`,
      width: `${w}px`,
    });
    Object.assign(this.mini.style, { font: textFont(s), padding: `${s}px ${3 * s}px ${2 * s}px` });
  }

  /** Rounded pixel box: 1px border with cut corners, cream fill (world px, scaled by the SVG). */
  private drawBox(): void {
    const { width: w, height: h } = this;
    this.box.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.box.replaceChildren();
    rects(this.box, BG, [[1, 1, w - 2, h - 2]]);
    rects(this.box, BORDER, [
      [2, 0, w - 4, 1],
      [2, h - 1, w - 4, 1],
      [0, 2, 1, h - 4],
      [w - 1, 2, 1, h - 4],
      [1, 1, 1, 1],
      [w - 2, 1, 1, 1],
      [1, h - 2, 1, 1],
      [w - 2, h - 2, 1, 1],
    ]);
  }
}
