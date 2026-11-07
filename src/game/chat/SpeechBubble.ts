import { FONT_STACK as FONT } from '../art/fonts';
import type { Vec2 } from '../core/iso';
import { placeAt, TEXT_SIZE, textFont } from '../ui/TextOverlay';
import { layoutBubble } from './chat';

const PAD_X = 4;
const PAD_Y = 2;
/** Line height and the gap between lines, in world px (as the in-game text had). */
const LINE_H = 8;
const LINE_GAP = 1;
/** Text width limit in world px; about 12 Korean syllables, so 24 fit in 2 lines. */
const MAX_TEXT_W = 74;
const TAIL_H = 3;
/** Keep this many world px between the bubble and the edge of the view. */
const MARGIN = 2;
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

/**
 * A pixel-art speech bubble that points at a character. Purely a view: local
 * and remote players' messages use the same bubble. Drawn in the page's text
 * layer (see TextOverlay) so its text is sharp on any screen; the box and the
 * stepped tail keep their pixel shapes (crisp-edged SVG). Sits above every
 * name tag and is kept inside the view.
 */
export class SpeechBubble {
  private readonly el: HTMLDivElement;
  private readonly box: SVGSVGElement;
  private readonly tail: SVGSVGElement;
  private readonly text: HTMLDivElement;
  /** Size in world px. */
  private width = 0;
  private height = 0;
  private lines: string[] = [];
  private scale = 0;
  /** Last placement, canvas CSS px. */
  private rect = { x: 0, y: 0, width: 0, height: 0, tailX: 0, tail: false };

  constructor(layer: HTMLElement) {
    this.el = document.createElement('div');
    this.el.dataset.bubble = '';
    Object.assign(this.el.style, { position: 'absolute', left: '0', top: '0', display: 'none', zIndex: String(Z) });
    this.box = svg('0 0 0 0');
    this.tail = svg(`-3 0 6 ${TAIL_H}`);
    // Small stepped tail; its top row overlaps the box's bottom border. Origin = tip column.
    rects(this.tail, BG, [[-2, 0, 4, 1], [-1, 1, 2, 1]]);
    rects(this.tail, BORDER, [[-3, 0, 1, 1], [2, 0, 1, 1], [-2, 1, 1, 1], [1, 1, 1, 1], [-1, 2, 2, 1]]);
    this.text = document.createElement('div');
    Object.assign(this.text.style, { position: 'absolute', left: '0', color: TEXT, textAlign: 'center', whiteSpace: 'pre' });
    this.el.append(this.box, this.tail, this.text);
    layer.appendChild(this.el);
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  /** Current text (lines joined by '\n'); '' when hidden. */
  get content(): string {
    return this.visible ? this.lines.join('\n') : '';
  }

  /** Box and tail tip in canvas CSS px (for tests), and the line count. */
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
    this.el.style.display = '';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  /**
   * Places the bubble so its tail points at `anchor` (canvas CSS px), shifted
   * to stay inside the view (`viewW` x `viewH`). The tail slides along the
   * bottom edge so it keeps pointing at the character. `scale`: CSS px per
   * world px for text (see textScale).
   */
  place(anchor: Vec2, viewW: number, viewH: number, scale: number): void {
    if (!this.visible) return;
    const s = scale;
    const w = Math.round(this.width * s);
    const h = Math.round(this.height * s);
    if (s !== this.scale) {
      this.scale = s;
      this.box.setAttribute('width', String(w));
      this.box.setAttribute('height', String(h));
      this.tail.setAttribute('width', String(6 * s));
      this.tail.setAttribute('height', String(TAIL_H * s));
      Object.assign(this.text.style, {
        font: textFont(s),
        lineHeight: `${(LINE_H + LINE_GAP) * s}px`,
        top: `${(PAD_Y - LINE_GAP / 2) * s}px`,
        width: `${w}px`,
      });
    }
    const ax = Math.round(anchor.x);
    const ay = Math.round(anchor.y);
    const margin = MARGIN * s;
    const minX = margin;
    const maxX = viewW - margin - w;
    const left = Math.round(Math.min(Math.max(ax - w / 2, minX), Math.max(minX, maxX)));
    let top = ay - TAIL_H * s - h;
    top = Math.round(Math.min(Math.max(top, margin), viewH - margin - h));
    placeAt(this.el, left, top);
    const tx = Math.round(Math.min(Math.max(ax, left + 4 * s), left + w - 4 * s));
    // Hide the tail if clamping pushed the bubble down over its anchor.
    const tail = top + h <= ay;
    this.tail.style.display = tail ? '' : 'none';
    this.tail.style.left = `${tx - left - 3 * s}px`;
    this.tail.style.top = `${h - s}px`;
    this.rect = { x: left, y: top, width: w, height: h, tailX: tx, tail };
  }

  destroy(): void {
    this.el.remove();
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
