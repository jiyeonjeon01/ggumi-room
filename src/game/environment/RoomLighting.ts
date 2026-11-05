import Phaser from 'phaser';
import { mix, PixelCanvas } from '../art/pixelCanvas';
import { drawScreenLight, drawWallGlow, type ScreenPlacement } from '../art/lampArt';
import type { LayerArt } from '../art/roomArt';
import { worldToScreen } from '../core/iso';
import type { EnvLook } from './look';

const HALO = 'light:halo';
const POOL = 'light:pool';
const WARM = 0xffc070;
const COOL = 0x9fd4ff;
const FADE_MS = 1200;

export interface RoomLightingDepths {
  /** Glow on the back walls (just above the walls). */
  wall: number;
  /** Lamp light on the floor (under furniture, so furniture hides it). */
  floor: number;
  /** The ambient MULTIPLY; bulb and screen glows go right above it. */
  air: number;
}

/**
 * Room-wide light: a MULTIPLY color over the whole scene (day = white, night
 * = soft lavender, never darker than ~80%), plus indoor light sources.
 * Each source lights real surfaces at their own depth instead of one blob
 * over everything:
 *  - lamps: a small glow at the bulb, a glow on the wall behind them, and a
 *    pool on the floor drawn under the furniture (so the nightstand hides
 *    the part under itself, like a real shadow);
 *  - screens: the screen face and a fan of light on the desk top in front
 *    of it; no floor light.
 * None of it touches collision or depth sorting. MULTIPLY and ADD work in
 * WebGL and Canvas.
 */
export class RoomLighting {
  private readonly overlay: Phaser.GameObjects.Rectangle;
  private glows: { image: Phaser.GameObjects.Image; strength: number }[] = [];
  private screenGlows: Phaser.GameObjects.Image[] = [];
  private sourcesKey = '';
  private ambient = 0xffffff;
  private lamp = 0;
  private screen = 0;
  private tween: Phaser.Tweens.Tween | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    lights: readonly { x: number; y: number; z: number }[],
    screens: readonly ScreenPlacement[],
    center: { x: number; y: number },
    private readonly depth: RoomLightingDepths,
  ) {
    ensureGlowTextures(scene);
    this.overlay = scene.add
      .rectangle(center.x, center.y, 20000, 20000, 0xffffff)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(depth.air)
      .setVisible(false);
    this.setSources(lights, screens);
  }

  /**
   * (Re)builds the lamp and screen glows, e.g. after furniture moved. Glow
   * textures are cached, so this is cheap; current strengths are kept.
   */
  setSources(lights: readonly { x: number; y: number; z: number }[], screens: readonly ScreenPlacement[]): void {
    const key = JSON.stringify([lights, screens]);
    if (key === this.sourcesKey) return;
    this.sourcesKey = key;
    for (const g of this.glows) g.image.destroy();
    for (const g of this.screenGlows) g.destroy();
    this.glows = [];
    this.screenGlows = [];
    const { scene, depth } = this;
    const add = (image: Phaser.GameObjects.Image, d: number) =>
      image.setBlendMode(Phaser.BlendModes.ADD).setDepth(d).setAlpha(0).setVisible(false);
    for (const l of lights) {
      const s = worldToScreen(l.x, l.y);
      const pool = add(scene.add.image(Math.round(s.x), Math.round(s.y), POOL), depth.floor);
      const halo = add(scene.add.image(Math.round(s.x), Math.round(s.y - l.z), HALO), depth.air + 1);
      this.glows.push({ image: pool, strength: 0.9 }, { image: halo, strength: 0.75 });
      // Glow on the nearer back wall, if the lamp stands close to one.
      const wall = l.x <= l.y ? 'left' : 'right';
      if (Math.min(l.x, l.y) < 1) {
        const u = wall === 'left' ? l.y : l.x;
        const key = `light:wall:${wall}:${u}:${l.z}`;
        const glow = add(layerImage(scene, key, () => drawWallGlow(wall, u, l.z, WARM)), depth.wall);
        this.glows.push({ image: glow, strength: 0.7 });
      }
    }
    for (const sc of screens) {
      const key = `light:screen:${Object.values(sc).join(':')}`;
      this.screenGlows.push(add(layerImage(scene, key, () => drawScreenLight(sc, COOL)), depth.air + 1));
    }
    this.set(this.ambient, this.lamp, this.screen);
  }

  /** Fades to the look's lighting; `animate` false applies it instantly. */
  apply(look: EnvLook, animate: boolean): void {
    this.tween?.stop();
    const fromAmbient = this.ambient;
    const fromLamp = this.lamp;
    const fromScreen = this.screen;
    const set = (v: number) =>
      this.set(
        mix(fromAmbient, look.ambient, v),
        fromLamp + (look.lamp - fromLamp) * v,
        fromScreen + (look.screen - fromScreen) * v,
      );
    if (!animate) {
      set(1);
      return;
    }
    this.tween = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: FADE_MS,
      ease: 'Sine.easeInOut',
      onUpdate: (tw) => set(tw.getValue() ?? 1),
    });
  }

  get state() {
    return { ambient: this.ambient, lamp: this.lamp, screen: this.screen, sources: this.sourcesKey };
  }

  private set(ambient: number, lamp: number, screen: number): void {
    this.ambient = ambient;
    this.lamp = lamp;
    this.screen = screen;
    for (const g of this.screenGlows) g.setAlpha(screen * 0.85).setVisible(screen > 0.01);
    this.overlay.setFillStyle(ambient).setVisible(ambient !== 0xffffff);
    for (const g of this.glows) g.image.setAlpha(lamp * g.strength).setVisible(lamp > 0.01);
  }
}

/** Pixel-art glows: concentric rings with stepped (not smooth) alpha. */
function ensureGlowTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(HALO)) {
    // Kept small: the shade glows; the room is lit by the wall and floor layers.
    const r = 9;
    const pc = new PixelCanvas(r * 2 + 1, r * 2 + 1);
    for (let y = 0; y <= r * 2; y++) {
      for (let x = 0; x <= r * 2; x++) {
        const d = Math.hypot(x - r, y - r);
        const a = d <= 4 ? 140 : d <= 6.5 ? 80 : d <= r ? ((x + y) % 2 ? 40 : 15) : 0;
        if (a) pc.set(x, y, WARM, a);
      }
    }
    scene.textures.addCanvas(HALO, pc.toCanvas());
  }
  if (!scene.textures.exists(POOL)) {
    // 2:1 ellipse so the light lies flat on the iso floor.
    const rx = 30;
    const ry = 15;
    const pc = new PixelCanvas(rx * 2 + 1, ry * 2 + 1);
    for (let y = 0; y <= ry * 2; y++) {
      for (let x = 0; x <= rx * 2; x++) {
        const d = Math.hypot((x - rx) / rx, (y - ry) / ry);
        const a = d <= 0.45 ? 90 : d <= 0.75 ? 55 : d <= 1 ? ((x + y) % 2 ? 30 : 15) : 0;
        if (a) pc.set(x, y, WARM, a);
      }
    }
    scene.textures.addCanvas(POOL, pc.toCanvas());
  }
}

/** Image of a cached layer texture whose anchor is world (0, 0, 0). */
const anchors = new Map<string, { x: number; y: number }>();
function layerImage(scene: Phaser.Scene, key: string, draw: () => LayerArt): Phaser.GameObjects.Image {
  let anchor = anchors.get(key);
  if (!anchor || !scene.textures.exists(key)) {
    const art = draw();
    anchor = { x: art.anchorX / art.canvas.width, y: art.anchorY / art.canvas.height };
    anchors.set(key, anchor);
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, art.canvas);
  }
  return scene.add.image(0, 0, key).setOrigin(anchor.x, anchor.y);
}
