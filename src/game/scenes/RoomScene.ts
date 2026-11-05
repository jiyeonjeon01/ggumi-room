import Phaser from 'phaser';
import { FLOOR_THICKNESS, WALL_HEIGHT, WALL_THICKNESS } from '../art/roomArt';
import { ensureAvatarTextures, ensureFurnitureTexture, ensureRoomTextures } from '../art/textures';
import { THEMES, type ThemeId } from '../art/themes';
import { CollisionWorld } from '../core/collision';
import { sortByDepth, type DepthItem } from '../core/depthSort';
import { screenToWorld, TILE_H, TILE_W, worldToScreen, type Vec2 } from '../core/iso';
import { NavGrid } from '../core/pathfinding';
import { Avatar, type Facing } from '../entities/Avatar';
import { AvatarController } from '../entities/AvatarController';
import { lookFor } from '../environment/look';
import { RoomLighting } from '../environment/RoomLighting';
import type { Period } from '../environment/timeOfDay';
import { BUBBLE_MS, type ChatMessage } from '../chat/chat';
import { SpeechBubble } from '../chat/SpeechBubble';
import { WindowLight } from '../environment/WindowLight';
import { WindowView } from '../environment/WindowView';
import { FURNITURE, spriteFrame } from '../room/furniture';
import { obstaclesOf, type RoomData } from '../room/roomData';

export const ROOM_SCENE = 'room';

export interface RoomSceneData {
  room: RoomData;
  theme?: ThemeId;
  /** Restores the player when the scene restarts (e.g. theme switch). */
  player?: { pos: Vec2; facing: Facing };
  period: Period;
  /** The local player's bubble carried over a restart, with its original expiry time. */
  chat?: ShownChat;
}

export interface ShownChat {
  message: ChatMessage;
  /** Date.now() time at which the bubble disappears. */
  expiresAt: number;
}

/**
 * Fixed draw layers around the depth-sorted object layer (0..n).
 * Lighting sits above all objects; name tags (10000+) stay unlit.
 */
const DEPTH = {
  floor: -3000,
  walls: -2900,
  /** Lamp glow on the back walls: over the wall paint, under windows and shelves. */
  lampWall: -2899.5,
  windowScenery: -2899,
  windowGlass: -2898.5,
  windowFrame: -2898,
  windowGlow: -2897.5,
  floorDecor: -2000,
  /** Window light on the floor: above rugs (floorDecor + i), below the marker. */
  floorLight: -1900,
  /** Lamp light on the floor, same layer band. */
  lampFloor: -1899,
  marker: -1500,
  /** Window light in the air: over objects, under the room's ambient light. */
  lightShaft: 8999,
  lighting: 9000,
} as const;

/** How often window scenery checks for a visible change (ms). */
const ENV_TICK_MS = 100;

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

class FurnitureItem implements DepthItem {
  constructor(
    readonly footprint: DepthItem['footprint'],
    readonly bounds: DepthItem['bounds'],
    readonly image: Phaser.GameObjects.Image,
  ) {}

  setDepth(d: number): void {
    this.image.setDepth(d);
  }
}

/**
 * One room: static layers (floor, walls), furniture, and the local player.
 * The same scene is meant to host personal rooms and the social room; what
 * differs between them (ownership, edit rights, other players) is data.
 */
export class RoomScene extends Phaser.Scene {
  private room!: RoomData;
  private themeId!: ThemeId;
  private initialPlayer?: RoomSceneData['player'];
  private period!: Period;
  private windows: WindowView[] = [];
  private lighting!: RoomLighting;
  private windowLight!: WindowLight;
  private nextEnvTick = 0;
  private bubble!: SpeechBubble;
  private shownChat: ShownChat | null = null;
  private bubbleTimer: Phaser.Time.TimerEvent | null = null;
  private initialChat?: ShownChat;

  private world!: CollisionWorld;
  private player!: Avatar;
  private controller!: AvatarController;
  private sortables: (Avatar | FurnitureItem)[] = [];
  private marker!: Phaser.GameObjects.Image;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;

  constructor() {
    super(ROOM_SCENE);
  }

  init(data: RoomSceneData): void {
    this.room = data.room;
    this.themeId = data.theme ?? data.room.theme;
    this.initialPlayer = data.player;
    this.period = data.period;
    this.initialChat = data.chat;
    this.shownChat = null;
    this.bubbleTimer = null;
    this.sortables = [];
    this.windows = [];
    this.nextEnvTick = 0;
  }

  create(): void {
    const { room } = this;
    const theme = THEMES[this.themeId];
    this.cameras.main.setBackgroundColor(theme.backdrop);

    const layers = ensureRoomTextures(this, room.width, room.height, theme);
    const origin = (art: { canvas: HTMLCanvasElement; anchorX: number; anchorY: number }) =>
      [art.anchorX / art.canvas.width, art.anchorY / art.canvas.height] as const;
    this.add.image(0, 0, layers.floor.key).setOrigin(...origin(layers.floor.art)).setDepth(DEPTH.floor);
    this.add.image(0, 0, layers.walls.key).setOrigin(...origin(layers.walls.art)).setDepth(DEPTH.walls);

    const look = lookFor(this.period, theme);
    this.windows = room.windows.map(
      (win) => new WindowView(this, win, theme, look, { scenery: DEPTH.windowScenery, frame: DEPTH.windowFrame }),
    );
    const lights = room.furniture.flatMap((f) => {
      const l = FURNITURE[f.id].light;
      return l ? [{ x: f.x + l.x, y: f.y + l.y, z: l.z }] : [];
    });
    const screens = room.furniture.flatMap((f) => {
      const sc = FURNITURE[f.id].screen;
      return sc ? [{ ...sc, x0: f.x + sc.x0, x1: f.x + sc.x1, y: f.y + sc.y }] : [];
    });
    this.lighting = new RoomLighting(this, lights, screens, worldToScreen(room.width / 2, room.height / 2), {
      wall: DEPTH.lampWall,
      floor: DEPTH.lampFloor,
      air: DEPTH.lighting,
    });
    this.lighting.apply(look, false);
    this.windowLight = new WindowLight(this, room.windows, room, { glow: DEPTH.windowGlow, glass: DEPTH.windowGlass, floor: DEPTH.floorLight, shaft: DEPTH.lightShaft });
    this.windowLight.apply(look, false);

    room.furniture.forEach((placement, i) => {
      const def = FURNITURE[placement.id];
      const frame = spriteFrame(def);
      const s = worldToScreen(placement.x, placement.y);
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      const image = this.add
        .image(x, y, ensureFurnitureTexture(this, def.id, theme))
        .setOrigin(frame.anchorX / frame.width, frame.anchorY / frame.height);
      if (!def.blocking) {
        // Flat decor (rugs, cushions) is always under characters.
        image.setDepth(DEPTH.floorDecor + i);
        return;
      }
      const left = x - frame.anchorX;
      const top = y - frame.anchorY;
      this.sortables.push(
        new FurnitureItem(
          { x: placement.x, y: placement.y, w: def.w, h: def.h },
          [left, top, left + frame.width, top + frame.height],
          image,
        ),
      );
    });

    const world = new CollisionWorld(room.width, room.height, obstaclesOf(room));
    this.world = world;
    ensureAvatarTextures(this);
    this.player = new Avatar(
      this,
      this.initialPlayer?.pos ?? room.spawn,
      room.owner,
      this.initialPlayer?.facing,
    );
    this.sortables.push(this.player);
    const nav = new NavGrid(world, this.player.radius);

    this.marker = this.add.image(0, 0, this.createMarkerTexture()).setDepth(DEPTH.marker).setVisible(false);
    this.tweens.add({ targets: this.marker, alpha: 0.35, yoyo: true, repeat: -1, duration: 450 });
    this.controller = new AvatarController(this.player, world, nav, (dest) => this.showMarker(dest));

    this.bubble = new SpeechBubble(this);
    if (this.initialChat) this.showChat(this.initialChat.message, this.initialChat.expiresAt);

    this.setupInput();
    this.fitCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
      this.bubbleTimer?.remove();
      this.bubbleTimer = null;
      this.bubble.destroy();
    });
    this.sortDepth();
  }

  update(time: number, delta: number): void {
    // Clamp long frames (tab switch) so movement stays stable; speed is per-second.
    const dt = Math.min(delta, 100) / 1000;
    const k = this.keys;
    const x = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    const y = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    this.controller.update(dt, x, y);
    this.sortDepth();
    this.bubble.place(this.player.bubbleAnchor, this.cameras.main.worldView);

    // Window scenery: cheap check at 10 Hz, re-render only on visible change.
    // Browsers suspend rAF for hidden tabs; the explicit check also covers
    // cases where frames still run (e.g. some embedded/background contexts).
    if (time >= this.nextEnvTick && !document.hidden) {
      this.nextEnvTick = time + ENV_TICK_MS;
      const still = reducedMotion?.matches ?? false;
      for (const w of this.windows) w.update(time / 1000, still);
    }
  }

  /** Switches the time-of-day look (sky, clouds, stars, room and window light). */
  applyPeriod(period: Period): void {
    if (period === this.period) return;
    this.period = period;
    const look = lookFor(period, THEMES[this.themeId]);
    for (const w of this.windows) w.setLook(look);
    this.nextEnvTick = 0;
    const animate = !(reducedMotion?.matches ?? false);
    this.lighting.apply(look, animate);
    this.windowLight.apply(look, animate);
  }

  /**
   * Shows a chat message as a speech bubble over its player. Only the local
   * player exists today; remote players would get their own Avatar + bubble
   * looked up by `message.playerId`. A new message replaces the old bubble
   * and restarts its timer (the old timer is removed, so it can't hide the
   * newer bubble early).
   */
  showChat(message: ChatMessage, expiresAt = Date.now() + BUBBLE_MS): void {
    if (message.playerId !== this.room.owner) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return;
    this.bubbleTimer?.remove();
    this.shownChat = { message, expiresAt };
    this.bubble.show(message.content);
    this.bubble.place(this.player.bubbleAnchor, this.cameras.main.worldView);
    this.bubbleTimer = this.time.delayedCall(remaining, () => {
      this.bubbleTimer = null;
      this.shownChat = null;
      this.bubble.hide();
    });
  }

  /** The bubble currently shown, used to carry it over scene restarts (theme switch). */
  getChatState(): ShownChat | undefined {
    return this.shownChat ?? undefined;
  }

  /**
   * Turns keyboard movement off while the chat input has focus. Keys held at
   * that moment are released so the character doesn't keep walking.
   */
  setKeyboardEnabled(enabled: boolean): void {
    if (!enabled) this.input.keyboard?.resetKeys();
  }

  /** Current player state, used to carry it over scene restarts. */
  getPlayerState(): NonNullable<RoomSceneData['player']> {
    return { pos: { ...this.player.pos }, facing: this.player.facing };
  }

  /** Dev/test hook: logical state snapshot. */
  debugState() {
    return {
      pos: { ...this.player.pos },
      facing: this.player.facing,
      state: this.player.state,
      /** False would mean the player overlaps a wall or furniture. */
      free: this.world.isFree(this.player.pos.x, this.player.pos.y, this.player.radius - 1e-6),
      destination: this.controller.destination,
      zoom: this.cameras.main.zoom,
      period: this.period,
      windows: this.windows.map((w) => ({ redraws: w.redraws, ...w.lastState })),
      lighting: this.lighting.state,
      bubble: {
        visible: this.bubble.visible,
        content: this.bubble.content,
        expiresAt: this.shownChat?.expiresAt ?? null,
        ...this.bubble.bounds,
        anchor: this.player.bubbleAnchor,
        view: (({ x, y, width, height }) => ({ x, y, width, height }))(this.cameras.main.worldView),
      },
      windowLight: this.windowLight.state,
      depthOrder: sortByDepth(this.sortables).map((s) => (s instanceof Avatar ? 'player' : s.image.texture.key)),
    };
  }

  /** Dev/test hook: world point -> position in the canvas element (CSS px). */
  debugWorldToCanvas(p: Vec2): Vec2 {
    const s = worldToScreen(p.x, p.y);
    const cam = this.cameras.main;
    const hw = cam.width / 2;
    const hh = cam.height / 2;
    return { x: (s.x - cam.scrollX - hw) * cam.zoom + hw, y: (s.y - cam.scrollY - hh) * cam.zoom + hh };
  }

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard input unavailable');
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys({
      up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D,
    }) as typeof this.keys;

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch && !pointer.leftButtonDown()) return;
      this.controller.walkTo(screenToWorld(pointer.worldX, pointer.worldY));
    });
  }

  private sortDepth(): void {
    sortByDepth(this.sortables).forEach((item, i) => item.setDepth(i));
  }

  private showMarker(dest: Vec2 | null): void {
    if (!dest) {
      this.marker.setVisible(false);
      return;
    }
    const s = worldToScreen(dest.x, dest.y);
    this.marker.setPosition(Math.round(s.x), Math.round(s.y)).setVisible(true).setAlpha(1);
  }

  /** A small pink diamond outline sized to half a tile. */
  private createMarkerTexture(): string {
    const key = 'marker';
    if (this.textures.exists(key)) return key;
    const w = TILE_W / 2;
    const h = TILE_H / 2;
    const canvas = this.textures.createCanvas(key, w + 1, h + 1);
    const ctx = canvas?.getContext();
    if (canvas && ctx) {
      ctx.fillStyle = '#ff7fae';
      for (let x = 0; x <= w; x++) {
        const dy = Math.round((h / 2) * (1 - Math.abs(x - w / 2) / (w / 2)));
        ctx.fillRect(x, h / 2 - dy, 1, 1);
        ctx.fillRect(x, h / 2 + dy, 1, 1);
      }
      canvas.refresh();
    }
    return key;
  }

  /**
   * Fixed camera that frames the whole room. Uses the largest integer zoom
   * that fits (crisp pixels); falls back to fractional zoom on tiny screens.
   */
  private fitCamera(): void {
    const { width, height } = this.scale.gameSize;
    const { room } = this;
    const T = WALL_THICKNESS;
    const left = -(room.height + T) * (TILE_W / 2);
    const right = (room.width + T) * (TILE_W / 2);
    const top = -WALL_HEIGHT - T * TILE_H - 4;
    const bottom = (room.width + room.height) * (TILE_H / 2) + FLOOR_THICKNESS;
    const margin = 24;
    const fit = Math.min((width - margin * 2) / (right - left), (height - margin * 2) / (bottom - top));
    const zoom = fit >= 1 ? Math.floor(fit) : Math.max(0.25, fit);

    const cam = this.cameras.main;
    cam.setZoom(zoom);
    cam.centerOn(Math.round((left + right) / 2), Math.round((top + bottom) / 2));
    this.player.setZoom(zoom);
    this.bubble.setZoom(zoom);
  }
}
