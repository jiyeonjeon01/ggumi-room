import Phaser from 'phaser';
import { ANCHOR_X, ANCHOR_Y, FRAME_H, FRAME_W } from '../art/avatarArt';
import { FONT_STACK } from '../art/fonts';
import { AVATAR_TEXTURE, SHADOW_TEXTURE } from '../art/textures';
import type { Rect } from '../core/collision';
import type { DepthItem } from '../core/depthSort';
import { worldDirToScreen, worldToScreen, type Vec2 } from '../core/iso';

/** Four iso facings: front/back x left/right (as seen on screen). */
export type Facing = 'front-right' | 'front-left' | 'back-right' | 'back-left';
export type AvatarState = 'idle' | 'walk';

export const AVATAR_RADIUS = 0.22;

/**
 * A character in a room: logical state (world position, facing, animation
 * state) plus its Phaser view. It knows nothing about input, so the same
 * class can later render remote players driven by network updates.
 */
export class Avatar implements DepthItem {
  readonly radius = AVATAR_RADIUS;
  pos: Vec2;
  facing: Facing = 'front-right';
  state: AvatarState = 'idle';

  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text | null;
  private playingKey = '';

  constructor(scene: Phaser.Scene, pos: Vec2, name?: string, facing: Facing = 'front-right') {
    this.pos = { ...pos };
    this.facing = facing;
    ensureAvatarAnimations(scene);
    this.shadow = scene.add.image(0, 0, SHADOW_TEXTURE).setDepth(-1000);
    this.sprite = scene.add.sprite(0, 0, AVATAR_TEXTURE, 'front-idle').setOrigin(ANCHOR_X / FRAME_W, ANCHOR_Y / FRAME_H);
    this.label = name ? createNameLabel(scene, name) : null;
    this.syncView();
  }

  get footprint(): Rect {
    const r = this.radius;
    return { x: this.pos.x - r, y: this.pos.y - r, w: r * 2, h: r * 2 };
  }

  get bounds(): DepthItem['bounds'] {
    const { x, y } = this.sprite;
    return [x - ANCHOR_X, y - ANCHOR_Y, x - ANCHOR_X + FRAME_W, y - ANCHOR_Y + FRAME_H];
  }

  /**
   * Updates facing and animation from the velocity actually travelled this
   * frame (world units/sec). Facing only changes on the axes that moved, so
   * walking straight sideways keeps looking front or back as before.
   */
  setMotion(vx: number, vy: number): void {
    const moving = Math.hypot(vx, vy) > 0.05;
    this.state = moving ? 'walk' : 'idle';
    if (moving) {
      const s = worldDirToScreen(vx, vy);
      const front = Math.abs(s.y) > 1e-3 ? s.y > 0 : this.facing.startsWith('front');
      const right = Math.abs(s.x) > 1e-3 ? s.x > 0 : this.facing.endsWith('right');
      this.facing = `${front ? 'front' : 'back'}-${right ? 'right' : 'left'}`;
    }
    this.syncView();
  }

  /** World px point just above the name tag, where a speech bubble's tail points. */
  get bubbleAnchor(): Vec2 {
    const top = this.label ? this.label.y - this.label.displayHeight : this.sprite.y - FRAME_H;
    return { x: this.sprite.x, y: top - 1 };
  }

  setPosition(pos: Vec2): void {
    this.pos = { ...pos };
    this.syncView();
  }

  /** Pushes logical state to the Phaser objects (whole-pixel positions). */
  syncView(): void {
    const s = worldToScreen(this.pos.x, this.pos.y);
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    this.sprite.setPosition(x, y);
    this.shadow.setPosition(x, y);
    this.label?.setPosition(x, y - FRAME_H - 2);

    const view = this.facing.startsWith('front') ? 'front' : 'back';
    this.sprite.setFlipX(this.facing.endsWith('left'));
    const key = `avatar-${this.state}-${view}`;
    if (key !== this.playingKey) {
      this.playingKey = key;
      this.sprite.play(key);
    }
  }

  /** Re-rasterizes the name tag for the current camera zoom. */
  setZoom(zoom: number): void {
    if (!this.label) return;
    this.label.setResolution(Math.max(1, zoom * window.devicePixelRatio));
    this.label.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  setDepth(depth: number): void {
    this.sprite.setDepth(depth);
    this.label?.setDepth(10000 + depth);
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
    this.label?.destroy();
  }
}

function ensureAvatarAnimations(scene: Phaser.Scene): void {
  const anims = scene.anims;
  if (anims.exists('avatar-idle-front')) return;
  const frames = (...names: string[]) => names.map((frame) => ({ key: AVATAR_TEXTURE, frame }));
  anims.create({
    key: 'avatar-idle-front',
    frames: [
      { key: AVATAR_TEXTURE, frame: 'front-idle', duration: 2600 },
      { key: AVATAR_TEXTURE, frame: 'front-blink', duration: 140 },
    ],
    repeat: -1,
  });
  anims.create({ key: 'avatar-idle-back', frames: frames('back-idle'), repeat: -1 });
  anims.create({
    key: 'avatar-walk-front',
    frames: frames('front-stepA', 'front-idle', 'front-stepB', 'front-idle'),
    frameRate: 9,
    repeat: -1,
  });
  anims.create({
    key: 'avatar-walk-back',
    frames: frames('back-stepA', 'back-idle', 'back-stepB', 'back-idle'),
    frameRate: 9,
    repeat: -1,
  });
}

/**
 * Name tag. Text is rasterized at the camera zoom with linear filtering so it
 * stays sharp, unlike the pixel art which uses nearest-neighbour scaling.
 */
function createNameLabel(scene: Phaser.Scene, name: string): Phaser.GameObjects.Text {
  const text = scene.add
    .text(0, 0, name, {
      fontFamily: FONT_STACK,
      fontSize: '6px',
      color: '#7a4a68',
      backgroundColor: '#fffaf3e6',
      padding: { x: 3, y: 1 },
    })
    .setOrigin(0.5, 1);
  return text;
}
