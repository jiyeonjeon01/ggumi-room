import type Phaser from 'phaser';
import { FONT_STACK } from '../art/fonts';

/**
 * In-game text (name tags, speech bubbles) drawn as HTML over the canvas.
 *
 * The canvas is as many pixels as the page has CSS pixels and is scaled up
 * with nearest-neighbour by the browser on high-density screens (phones,
 * laptops at 125-200 %), which keeps the pixel art crisp but turns small text
 * into blocks. Text in the page is drawn by the browser at the screen's full
 * resolution with the same font, so it stays sharp at any zoom; the room
 * itself is untouched.
 *
 * Elements are positioned in canvas CSS px every frame, after the camera has
 * moved (see RoomScene.syncText), so they never trail the characters.
 */

/** Text size in world px (the size it had when drawn inside the game). */
export const TEXT_SIZE = 6;
/** Never smaller than this on screen (CSS px), so tiny zooms (phones) stay readable. */
const MIN_TEXT_PX = 11;
const ATTR = 'data-game-text';

/** CSS px per world px for text: the camera zoom, but never below the readable minimum. */
export function textScale(zoom: number): number {
  return Math.max(zoom, MIN_TEXT_PX / TEXT_SIZE);
}

export function textFont(scale: number): string {
  return `${TEXT_SIZE * scale}px ${FONT_STACK}`;
}

const overlays = new WeakMap<Phaser.Game, HTMLDivElement>();

/** The text layer of a game (created next to its canvas on first use). */
export function textLayer(game: Phaser.Game): HTMLDivElement {
  let root = overlays.get(game);
  if (root?.isConnected) return root;
  const parent = game.canvas.parentElement ?? document.body;
  root = document.createElement('div');
  root.setAttribute(ATTR, '');
  root.setAttribute('aria-hidden', 'true');
  // Own stacking context: z-indexes inside never reach page UI (cards, dialogs).
  Object.assign(root.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '0', isolation: 'isolate' });
  parent.appendChild(root);
  overlays.set(game, root);
  return root;
}

/** Removes the text layer (the game is going away). */
export function removeTextLayer(game: Phaser.Game): void {
  overlays.get(game)?.remove();
  overlays.delete(game);
}

/** Canvas-placed element base: whole-pixel transforms, cached size. */
export function placeAt(el: HTMLElement, x: number, y: number): void {
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/**
 * A character's name tag: the same cream label as before, bottom-centred
 * on its point. Size is measured once per text scale.
 */
export class NameTag {
  readonly el: HTMLDivElement;
  private scale = 0;
  private w = 0;
  private h = 0;

  constructor(layer: HTMLElement, name: string) {
    this.el = document.createElement('div');
    this.el.textContent = name;
    this.el.dataset.nameTag = name;
    Object.assign(this.el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      whiteSpace: 'nowrap',
      color: '#7a4a68',
      background: 'rgba(255, 250, 243, 0.9)',
    });
    layer.appendChild(this.el);
  }

  /** On-screen height (CSS px), for the speech bubble above it. */
  get height(): number {
    return this.h;
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
  }

  /** Front characters' tags over back ones (same order as the sprites). */
  setOrder(order: number): void {
    this.el.style.zIndex = String(order + 1);
  }

  /** `x`, `bottom`: canvas CSS px. */
  place(x: number, bottom: number, scale: number): void {
    if (!this.visible) return; // a hidden element has no size to measure
    if (scale !== this.scale || !this.w) {
      this.scale = scale;
      Object.assign(this.el.style, { font: textFont(scale), lineHeight: `${Math.round(TEXT_SIZE * 1.3 * scale)}px`, padding: `${scale}px ${3 * scale}px` });
      this.w = this.el.offsetWidth;
      this.h = this.el.offsetHeight;
    }
    placeAt(this.el, x - this.w / 2, bottom - this.h);
  }

  destroy(): void {
    this.el.remove();
  }
}
