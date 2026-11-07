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
/** Name tags are a little smaller than speech, with their own floor. */
const TAG_SIZE = 5;
const MIN_TAG_PX = 10;
const ATTR = 'data-game-text';

/** Bumped when a font finishes loading (the app starts without waiting for it): tags measure again. */
let fontEpoch = 0;
if (typeof document !== 'undefined') document.fonts?.addEventListener?.('loadingdone', () => fontEpoch++);

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
 * A character's name tag, bottom-centred on its point: a small rounded pill
 * (plum, or pink for the player's own character) so it never looks like a
 * speech bubble (cream box, pink pixel border, tail). Size is measured once
 * per text scale.
 */
export class NameTag {
  readonly el: HTMLDivElement;
  private scale = 0;
  private w = 0;
  private h = 0;
  private epoch = -1;

  constructor(layer: HTMLElement, name: string) {
    this.el = document.createElement('div');
    this.el.textContent = name;
    this.el.dataset.nameTag = name;
    Object.assign(this.el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      whiteSpace: 'nowrap',
      borderRadius: '999px',
      color: '#fffaf3',
      background: 'rgba(74, 43, 64, 0.62)',
    });
    layer.appendChild(this.el);
  }

  /** The player's own character: pink instead of plum, to find yourself at a glance. */
  markSelf(): void {
    this.el.dataset.self = '';
    this.el.style.background = 'rgba(229, 112, 159, 0.88)';
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
    if (scale !== this.scale || !this.w || this.epoch !== fontEpoch) {
      this.scale = scale;
      this.epoch = fontEpoch;
      const px = Math.max(TAG_SIZE * scale, MIN_TAG_PX);
      Object.assign(this.el.style, { font: `${px}px ${FONT_STACK}`, lineHeight: `${Math.round(px * 1.3)}px`, padding: `0 ${Math.round(px * 0.5)}px` });
      this.w = this.el.offsetWidth;
      this.h = this.el.offsetHeight;
    }
    placeAt(this.el, x - this.w / 2, bottom - this.h);
  }

  destroy(): void {
    this.el.remove();
  }
}
