import Phaser from 'phaser';
import type { LayerArt } from '../art/roomArt';
import { drawFloorLight, drawGlassSheen, drawLightShaft, drawWindowGlow } from '../art/sunlightArt';
import { glassGeometry } from '../art/windowArt';
import type { WindowPlacement } from '../room/roomData';
import type { EnvLook } from './look';

/** Same fade as RoomLighting so sky, room light and window light move together. */
const FADE_MS = 1200;

type Sunlight = EnvLook['sunlight'];

/** Origin of each cached layer texture (textures outlive scene restarts). */
const anchors = new Map<string, { x: number; y: number }>();

/**
 * Natural light from the room's windows (separate from the lamp light in
 * RoomLighting): a sheen on each window's glass and the window's light
 * pattern on the floor. Each look gets its own pre-rendered textures (cached
 * by the TextureManager across scene restarts); a period change creates the
 * new images and cross-fades them with the old ones, which also lets the
 * patch's shape shift with the sun. Nothing is redrawn per frame.
 *
 * The light shaft is in the air, so it is drawn over furniture and
 * characters (like the lamp halo), but under the ambient MULTIPLY.
 * The window glow stays faint and under the room's ambient MULTIPLY: the
 * window is an opening that lets light in, not a light source like the lamp.
 * The floor patch sits on the floor-decor layer: above floor and rugs, below
 * furniture and characters, so things standing in the light hide it instead
 * of being painted over. The ambient MULTIPLY in RoomLighting still applies.
 */
export class WindowLight {
  private current: Phaser.GameObjects.Image[] = [];
  private sun: Sunlight | null = null;
  private tween: Phaser.Tweens.Tween | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly windows: readonly WindowPlacement[],
    private readonly room: { width: number; height: number },
    private readonly depth: { glow: number; glass: number; floor: number; shaft: number },
  ) {}

  apply(look: EnvLook, animate: boolean): void {
    const sun = look.sunlight;
    if (this.sun && sameSun(this.sun, sun)) return;
    this.sun = sun;
    this.tween?.complete();

    const outgoing = this.current;
    const incoming = this.windows.flatMap((win) => this.createImages(win, sun));
    this.current = incoming;
    const targets = incoming.map((img) => img.getData('alpha') as number);
    const starts = outgoing.map((img) => img.alpha);
    const set = (v: number) => {
      incoming.forEach((img, i) => img.setAlpha((targets[i] ?? 0) * v));
      outgoing.forEach((img, i) => img.setAlpha((starts[i] ?? 0) * (1 - v)));
    };
    const done = () => {
      set(1);
      for (const img of outgoing) img.destroy();
      this.tween = null;
    };
    if (!animate || outgoing.length === 0) {
      done();
      return;
    }
    set(0);
    this.tween = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: FADE_MS,
      ease: 'Sine.easeInOut',
      onUpdate: (tw) => set(tw.getValue() ?? 1),
      onComplete: done,
    });
  }

  /** Dev/test snapshot. */
  get state() {
    return {
      sunlight: this.sun,
      images: this.current.map((img) => ({ key: img.texture.key, alpha: img.alpha, depth: img.depth })),
    };
  }

  private createImages(win: WindowPlacement, sun: Sunlight): Phaser.GameObjects.Image[] {
    const { scene } = this;
    const id = `${win.wall}:${win.u0}:${win.u1}:${win.z0}:${win.z1}`;
    const hex = (c: number) => c.toString(16).padStart(6, '0');
    const color = hex(sun.color);
    const tint = hex(sun.tint);

    const geom = glassGeometry(win);
    const glassKey = `sun-glass:${id}:${color}:${sun.glass}`;
    if (!scene.textures.exists(glassKey)) scene.textures.addCanvas(glassKey, drawGlassSheen(geom, sun.color, sun.glass));
    const glass = scene.add
      .image(geom.x, geom.y, glassKey)
      .setOrigin(0, 0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(this.depth.glass);
    glass.setData('alpha', 1); // strength is baked into the texture

    const floorKey = `sun-floor:${id}:${this.room.width}x${this.room.height}:${color}:${Object.values(sun.ray).join(':')}`;
    const floor = this.addLayer(floorKey, () => drawFloorLight(win, sun.ray, this.room, sun.color), this.depth.floor);
    floor.setData('alpha', sun.floor);

    const glow = this.addLayer(`sun-glow:${id}:${tint}`, () => drawWindowGlow(win, sun.tint), this.depth.glow);
    glow.setData('alpha', sun.glow);
    const shaftKey = `sun-shaft:${id}:${color}:${Object.values(sun.ray).join(':')}`;
    const shaft = this.addLayer(shaftKey, () => drawLightShaft(win, sun.ray, sun.color), this.depth.shaft);
    shaft.setData('alpha', sun.shaft);
    return [glow, glass, floor, shaft];
  }

  /** ADD-blended image of a cached layer whose anchor sits at world (0, 0). */
  private addLayer(key: string, draw: () => LayerArt, depth: number): Phaser.GameObjects.Image {
    const { scene } = this;
    let anchor = anchors.get(key);
    if (!anchor || !scene.textures.exists(key)) {
      const art = draw();
      anchor = { x: art.anchorX / art.canvas.width, y: art.anchorY / art.canvas.height };
      anchors.set(key, anchor);
      if (!scene.textures.exists(key)) scene.textures.addCanvas(key, art.canvas);
    }
    return scene.add.image(0, 0, key).setOrigin(anchor.x, anchor.y).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth);
  }
}

function sameSun(a: Sunlight, b: Sunlight): boolean {
  return a.color === b.color && a.tint === b.tint && a.glass === b.glass && a.glow === b.glow && a.floor === b.floor && a.shaft === b.shaft && Object.values(a.ray).join() === Object.values(b.ray).join();
}
