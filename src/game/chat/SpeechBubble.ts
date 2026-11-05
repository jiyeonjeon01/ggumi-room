import Phaser from 'phaser';
import { FONT_STACK as FONT } from '../art/fonts';
import type { Vec2 } from '../core/iso';
import { layoutBubble } from './chat';

const FONT_SIZE = 6;
const PAD_X = 4;
const PAD_Y = 2;
/** Text width limit in world px; about 12 Korean syllables, so 24 fit in 2 lines. */
const MAX_TEXT_W = 74;
const TAIL_H = 3;
/** Keep this many world px between the bubble and the edge of the view. */
const MARGIN = 2;
/** Above name tags (10000 + n) and room lighting (9000): bubbles are UI, never lit or hidden by furniture. */
const DEPTH = 20000;

const BG = 0xfffaf3;
const BORDER = 0xe9a8c4;
const TEXT = '#7a4a68';

let measureCtx: CanvasRenderingContext2D | null = null;
/** Width of a string in world px, measured with the same font the bubble renders. */
function measure(s: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return s.length * FONT_SIZE;
  measureCtx.font = `${FONT_SIZE}px ${FONT}`;
  return measureCtx.measureText(s).width;
}

/**
 * A pixel-art speech bubble that points at a character. Purely a view: it
 * knows nothing about chat transport, so local and (later) remote players'
 * messages use the same bubble. Lives above everything in the room so it
 * stays readable when its character walks behind furniture, and is kept
 * inside the camera view.
 */
export class SpeechBubble {
  private readonly box: Phaser.GameObjects.Graphics;
  private readonly tail: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private width = 0;
  private height = 0;

  constructor(scene: Phaser.Scene) {
    this.box = scene.add.graphics().setDepth(DEPTH).setVisible(false);
    this.tail = scene.add.graphics().setDepth(DEPTH + 1).setVisible(false);
    this.text = scene.add
      .text(0, 0, '', {
        fontFamily: FONT,
        fontSize: `${FONT_SIZE}px`,
        color: TEXT,
        align: 'center',
        lineSpacing: 1,
        // Font metrics are measured on this string; include Hangul so its
        // taller glyphs get a full line (the default Latin-only test string
        // clipped the second line).
        testString: '|MÉqgy가힣',
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH + 2)
      .setVisible(false);
    this.drawTail();
  }

  get visible(): boolean {
    return this.box.visible;
  }

  /** Current text (lines joined by '\n'); '' when hidden. */
  get content(): string {
    return this.visible ? this.text.text : '';
  }

  /** Box and tail tip in world px (for tests). */
  get bounds() {
    return {
      x: this.box.x,
      y: this.box.y,
      width: this.width,
      height: this.height,
      tailX: this.tail.x,
      tail: this.tail.visible,
      lines: this.text.text.split('\n').length,
    };
  }

  show(content: string): void {
    const { lines, width } = layoutBubble(content, MAX_TEXT_W, measure);
    this.text.setText(lines.join('\n'));
    // Size the box from the rendered text, so it always fits what is drawn.
    this.width = Math.ceil(Math.max(width, this.text.width)) + PAD_X * 2;
    this.height = Math.ceil(this.text.height) + PAD_Y * 2;
    this.drawBox();
    this.setVisible(true);
  }

  hide(): void {
    this.setVisible(false);
  }

  /**
   * Places the bubble so its tail points at `anchor` (world px), shifted to
   * stay inside `view` (the camera's world view). The tail slides along the
   * bottom edge so it keeps pointing at the character.
   */
  place(anchor: Vec2, view: Phaser.Geom.Rectangle): void {
    if (!this.visible) return;
    const ax = Math.round(anchor.x);
    const ay = Math.round(anchor.y);
    const minX = view.x + MARGIN;
    const maxX = view.right - MARGIN - this.width;
    const left = Math.round(Math.min(Math.max(ax - this.width / 2, minX), Math.max(minX, maxX)));
    let top = ay - TAIL_H - this.height;
    top = Math.round(Math.min(Math.max(top, view.y + MARGIN), view.bottom - MARGIN - this.height));
    this.box.setPosition(left, top);
    this.text.setPosition(left + Math.round(this.width / 2), top + PAD_Y);
    const tx = Math.min(Math.max(ax, left + 4), left + this.width - 4);
    // Hide the tail if clamping pushed the bubble down over its anchor.
    this.tail.setPosition(tx, top + this.height - 1).setVisible(top + this.height <= ay);
  }

  /** Re-rasterizes the text for the camera zoom (same approach as name tags). */
  setZoom(zoom: number): void {
    this.text.setResolution(Math.max(1, zoom * window.devicePixelRatio));
    this.text.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  destroy(): void {
    this.box.destroy();
    this.tail.destroy();
    this.text.destroy();
  }

  private setVisible(v: boolean): void {
    this.box.setVisible(v);
    this.tail.setVisible(v);
    this.text.setVisible(v);
  }

  /** Rounded pixel box: 1px border with cut corners, cream fill. */
  private drawBox(): void {
    const { width: w, height: h } = this;
    const g = this.box.clear();
    g.fillStyle(BG).fillRect(1, 1, w - 2, h - 2);
    g.fillStyle(BORDER);
    g.fillRect(2, 0, w - 4, 1).fillRect(2, h - 1, w - 4, 1);
    g.fillRect(0, 2, 1, h - 4).fillRect(w - 1, 2, 1, h - 4);
    for (const [x, y] of [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]] as const) g.fillRect(x, y, 1, 1);
  }

  /** Small stepped tail; its top row overlaps the box's bottom border. Origin = tip column. */
  private drawTail(): void {
    const g = this.tail.clear();
    g.fillStyle(BG).fillRect(-2, 0, 4, 1).fillRect(-1, 1, 2, 1);
    g.fillStyle(BORDER).fillRect(-3, 0, 1, 1).fillRect(2, 0, 1, 1);
    g.fillRect(-2, 1, 1, 1).fillRect(1, 1, 1, 1);
    g.fillRect(-1, 2, 2, 1);
  }
}
