import Phaser from 'phaser';
import { composeScenery, drawWindowFrame, glassGeometry, type GlassGeometry } from '../art/windowArt';
import type { RoomTheme } from '../art/themes';
import type { WindowPlacement } from '../room/roomData';
import type { EnvLook } from './look';

/** Cloud drift in pixels per second (very slow on purpose). */
const CLOUD_SPEEDS = [0.5, 0.32];
const CLOUD_PHASES = [4, 22];
/** Star levels shown when motion is reduced: varied but still. */
const STILL_STARS = [2, 1, 3, 1, 2, 0, 2, 1, 3, 2, 1, 2];

/**
 * One window in a room: a static frame overlay plus an animated scenery
 * texture behind it. The scenery is re-rendered only when a visible pixel
 * would change (a cloud moved a whole pixel or a star changed level), which
 * at these speeds is a few times per second at most.
 */
export class WindowView {
  private readonly geom: GlassGeometry;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private look: EnvLook;
  private signature = '';
  /** Number of scenery re-renders (exposed for tests). */
  redraws = 0;
  lastState: { clouds: number[]; stars: number[] } = { clouds: [], stars: [] };

  constructor(scene: Phaser.Scene, win: WindowPlacement, theme: RoomTheme, look: EnvLook, depth: { scenery: number; frame: number }) {
    this.look = look;
    this.geom = glassGeometry(win);
    const id = `${win.wall}:${win.u0}:${win.u1}:${win.z0}:${win.z1}`;

    // The scenery texture is reused across scene restarts (theme switches).
    const sceneKey = `window-scene:${id}`;
    const existing = scene.textures.exists(sceneKey) ? scene.textures.get(sceneKey) : null;
    const texture =
      existing instanceof Phaser.Textures.CanvasTexture
        ? existing
        : scene.textures.createCanvas(sceneKey, this.geom.width, this.geom.height);
    if (!texture) throw new Error(`Could not create ${sceneKey}`);
    this.texture = texture;
    scene.add.image(this.geom.x, this.geom.y, sceneKey).setOrigin(0, 0).setDepth(depth.scenery);

    const frameKey = `window-frame:${theme.id}:${id}`;
    const frame = drawWindowFrame(win, theme);
    if (!scene.textures.exists(frameKey)) scene.textures.addCanvas(frameKey, frame.canvas);
    scene.add
      .image(0, 0, frameKey)
      .setOrigin(frame.anchorX / frame.canvas.width, frame.anchorY / frame.canvas.height)
      .setDepth(depth.frame);
  }

  setLook(look: EnvLook): void {
    this.look = look;
    this.signature = ''; // force a redraw
  }

  /** @param seconds scene time; @param still true when the user prefers reduced motion */
  update(seconds: number, still: boolean): void {
    const look = this.look;
    const clouds = CLOUD_SPEEDS.slice(0, look.cloudCount).map((v, i) =>
      Math.round((CLOUD_PHASES[i] ?? 0) + (still ? 0 : seconds * v)),
    );
    const stars = this.geom.stars
      .slice(0, look.starCount)
      .map((_, i) => (still ? (STILL_STARS[i] ?? 2) : starLevel(seconds, i)));
    const signature = `${clouds.join(',')}|${stars.join('')}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.lastState = { clouds, stars };

    const pc = composeScenery(this.geom, look, { clouds, stars });
    this.texture.getContext().putImageData(new ImageData(pc.data, pc.width, pc.height), 0, 0);
    this.texture.refresh();
    this.redraws++;
  }
}

/**
 * Each star twinkles on its own period (1.8–4.2 s) and phase, with a slower
 * second wave so the pattern never syncs up. Quantized to 4 levels.
 */
function starLevel(t: number, i: number): number {
  const period = 1.8 + ((i * 0.618) % 1) * 2.4;
  const phase = i * 2.39;
  const b = 0.5 + 0.35 * Math.sin((t / period) * Math.PI * 2 + phase) + 0.15 * Math.sin((t / (period * 2.7)) * Math.PI * 2 + phase * 1.7);
  return Math.max(0, Math.min(3, Math.floor(b * 4)));
}
