import Phaser from 'phaser';
import { FLOOR_THICKNESS, WALL_HEIGHT, WALL_THICKNESS } from '../art/roomArt';
import { ensureAvatarTextures, ensureFurnitureTexture, ensureRoomTextures } from '../art/textures';
import { THEMES, type ThemeId } from '../art/themes';
import { CollisionWorld } from '../core/collision';
import { sortByDepth, type DepthItem } from '../core/depthSort';
import { screenToWorld, TILE_H, TILE_W, worldToScreen, type Vec2 } from '../core/iso';
import { NavGrid } from '../core/pathfinding';
import { Avatar, AVATAR_RADIUS, type Facing } from '../entities/Avatar';
import { AvatarController } from '../entities/AvatarController';
import { lookFor } from '../environment/look';
import { RoomLighting } from '../environment/RoomLighting';
import type { Period } from '../environment/timeOfDay';
import { BUBBLE_MS, type ChatMessage } from '../chat/chat';
import { SpeechBubble } from '../chat/SpeechBubble';
import { WindowLight } from '../environment/WindowLight';
import { WindowView } from '../environment/WindowView';
import type { EditItem, LayoutEditor } from '../core/layoutEditor';
import { footprint, snap, type LayoutError } from '../core/placement';
import { FURNITURE, lightOf, screenOf, spriteFrame } from '../room/furniture';
import { MoveReporter, RemoteMotion, type MoveState } from '../net/motion';
import { obstaclesOf, type FurniturePlacement, type RoomData } from '../room/roomData';

export const ROOM_SCENE = 'room';

export interface RoomSceneData {
  room: RoomData;
  theme?: ThemeId;
  /** Restores the player when the scene restarts (e.g. theme switch). */
  player?: { pos: Vec2; facing: Facing };
  period: Period;
  /** The local player's bubble carried over a restart, with its original expiry time. */
  chat?: ShownChat;
  /** Other people in the room (realtime), recreated after a restart. */
  remotes?: RemoteMember[];
  /** Where the local player's movement goes (throttled); none for offline rooms. */
  onLocalMove?: (state: MoveState) => void;
}

/** Someone else in the room, as the server describes them. */
export interface RemoteMember extends MoveState {
  id: string;
  nickname: string;
}

interface Remote {
  avatar: Avatar;
  motion: RemoteMotion;
  bubble: SpeechBubble;
  bubbleTimer: Phaser.Time.TimerEvent | null;
  nickname: string;
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
    public footprint: DepthItem['footprint'],
    public bounds: DepthItem['bounds'],
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
  /** Furniture sprites by id (edit-session uid while editing). */
  private furniture = new Map<string, { image: Phaser.GameObjects.Image; sortable: FurnitureItem | null; placement: FurniturePlacement }>();
  private editor: LayoutEditor | null = null;
  private editUnsubscribe: (() => void) | null = null;
  private onEditReject: ((error: LayoutError) => void) | null = null;
  private drag: { uid: string; grab: Vec2; start: Vec2; cur: Vec2 } | null = null;
  private selection!: Phaser.GameObjects.Graphics;
  private marker!: Phaser.GameObjects.Image;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private remotes = new Map<string, Remote>();
  private initialRemotes: RemoteMember[] = [];
  private onLocalMove?: (state: MoveState) => void;
  private reporter = new MoveReporter();

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
    this.furniture = new Map();
    this.editor = null;
    this.editUnsubscribe = null;
    this.drag = null;
    this.windows = [];
    this.nextEnvTick = 0;
    this.remotes = new Map();
    this.initialRemotes = data.remotes ?? [];
    this.onLocalMove = data.onLocalMove;
    this.reporter = new MoveReporter();
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
    this.lighting = new RoomLighting(this, [], [], worldToScreen(room.width / 2, room.height / 2), {
      wall: DEPTH.lampWall,
      floor: DEPTH.lampFloor,
      air: DEPTH.lighting,
    });
    this.lighting.apply(look, false);
    this.windowLight = new WindowLight(this, room.windows, room, { glow: DEPTH.windowGlow, glass: DEPTH.windowGlass, floor: DEPTH.floorLight, shaft: DEPTH.lightShaft });
    this.windowLight.apply(look, false);

    this.renderFurniture(room.furniture.map((p, i) => ({ uid: `n${i}`, placement: p })));

    const world = new CollisionWorld(room.width, room.height, obstaclesOf(room));
    this.world = world;
    ensureAvatarTextures(this);
    const nav = new NavGrid(world, AVATAR_RADIUS);
    // After a layout change the old spot may be inside furniture or in a tiny
    // corner cut off from the rest of the floor: step to the nearest spot of
    // the main floor area. (Decorating hides the character, so the editor
    // doesn't keep furniture off it; this is where it gets sorted out.)
    let start = this.initialPlayer?.pos ?? room.spawn;
    const main = nav.mainArea();
    const here = nav.cellOf(start);
    if (!world.isFree(start.x, start.y, AVATAR_RADIUS) || !main.has(here.r * nav.cols + here.c)) {
      const cell = nav.nearestWalkableCell(start, main) ?? nav.nearestWalkableCell(start);
      if (cell) start = nav.cellCenter(cell.c, cell.r);
    }
    this.player = new Avatar(this, start, room.owner, this.initialPlayer?.facing);
    this.sortables.push(this.player);

    this.marker = this.add.image(0, 0, this.createMarkerTexture()).setDepth(DEPTH.marker).setVisible(false);
    this.selection = this.add.graphics().setDepth(DEPTH.marker - 1);
    this.tweens.add({ targets: this.marker, alpha: 0.35, yoyo: true, repeat: -1, duration: 450 });
    this.controller = new AvatarController(this.player, world, nav, (dest) => this.showMarker(dest));

    this.bubble = new SpeechBubble(this);
    if (this.initialChat) this.showChat(this.initialChat.message, this.initialChat.expiresAt);
    for (const m of this.initialRemotes) this.addRemote(m);

    this.setupInput();
    this.fitCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
      this.bubbleTimer?.remove();
      this.bubbleTimer = null;
      this.bubble.destroy();
      this.editUnsubscribe?.();
      for (const r of this.remotes.values()) {
        r.bubbleTimer?.remove();
        r.bubble.destroy();
      }
    });
    this.sortDepth();
  }

  update(time: number, delta: number): void {
    // Clamp long frames (tab switch) so movement stays stable; speed is per-second.
    const dt = Math.min(delta, 100) / 1000;
    const k = this.keys;
    const x = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    const y = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    // While decorating, the character stays put.
    if (!this.editor) this.controller.update(dt, x, y);
    if (this.onLocalMove) {
      const p = this.player;
      const out = this.reporter.update(performance.now(), { x: p.pos.x, y: p.pos.y, f: p.facing, s: p.state });
      if (out) this.onLocalMove(out);
    }
    const nowMs = performance.now();
    for (const r of this.remotes.values()) {
      const st = r.motion.sample(nowMs);
      r.avatar.pos = { x: st.x, y: st.y };
      r.avatar.facing = st.f;
      r.avatar.state = st.s;
      r.avatar.syncView();
    }
    this.sortDepth();
    const view = this.cameras.main.worldView;
    this.bubble.place(this.player.bubbleAnchor, view);
    for (const r of this.remotes.values()) if (r.bubble.visible) r.bubble.place(r.avatar.bubbleAnchor, view);

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

  // ---------------------------------------------------------------- other people (realtime)

  /** Replaces everyone else in the room (after joining or rejoining). */
  setRemotes(members: readonly RemoteMember[]): void {
    const keep = new Set(members.map((m) => m.id));
    for (const id of [...this.remotes.keys()]) if (!keep.has(id)) this.removeRemote(id);
    for (const m of members) {
      const r = this.remotes.get(m.id);
      if (r) r.motion.jump(m, performance.now());
      else this.addRemote(m);
    }
  }

  addRemote(m: RemoteMember): void {
    if (this.remotes.has(m.id)) return this.moveRemote(m.id, m);
    const avatar = new Avatar(this, { x: m.x, y: m.y }, m.nickname, m.f);
    avatar.setZoom(this.cameras.main.zoom);
    const bubble = new SpeechBubble(this);
    bubble.setZoom(this.cameras.main.zoom);
    if (this.editor) avatar.setVisible(false); // joined while we're decorating
    this.remotes.set(m.id, { avatar, motion: new RemoteMotion(m, performance.now()), bubble, bubbleTimer: null, nickname: m.nickname });
    this.sortables.push(avatar);
    this.sortDepth();
  }

  moveRemote(id: string, state: MoveState): void {
    this.remotes.get(id)?.motion.push(state, performance.now());
  }

  removeRemote(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    r.bubbleTimer?.remove();
    r.bubble.destroy();
    r.avatar.destroy();
    this.sortables = this.sortables.filter((s) => s !== r.avatar);
  }

  /** Someone else's speech bubble: same look and 5 s lifetime as the local one; a newer one replaces it. */
  sayRemote(id: string, content: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    r.bubbleTimer?.remove();
    if (this.editor) return; // no bubbles while decorating (they'd float over furniture)
    r.bubble.show(content);
    r.bubble.place(r.avatar.bubbleAnchor, this.cameras.main.worldView);
    r.bubbleTimer = this.time.delayedCall(BUBBLE_MS, () => {
      r.bubbleTimer = null;
      r.bubble.hide();
    });
  }

  /** Where everyone else is right now (carried over a scene restart). */
  getRemotes(): RemoteMember[] {
    return [...this.remotes.entries()].map(([id, r]) => ({ id, nickname: r.nickname, ...r.motion.sample(performance.now()) }));
  }

  /** The server didn't accept our position (too fast, inside furniture): go back to where it last agreed. */
  fixLocal(x: number, y: number): void {
    this.controller.stop();
    this.player.setPosition({ x, y });
    this.player.setMotion(0, 0);
    this.reporter.reset();
  }

  /** The next movement report goes out even if nothing changed (after (re)joining). */
  resendPosition(): void {
    this.reporter.reset();
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
      furniture: [...this.furniture.values()].map((f) => f.placement),
      obstacles: this.world.obstacles,
      editing: this.editor !== null,
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
      depthOrder: sortByDepth(this.sortables).map((s) => (s === this.player ? 'player' : s instanceof Avatar ? 'remote' : s.image.texture.key)),
      peopleVisible: this.player.visible,
      remotes: this.getRemotes().map((r) => ({ ...r, visible: this.remotes.get(r.id)?.avatar.visible ?? false, bubble: this.remotes.get(r.id)?.bubble.visible ? this.remotes.get(r.id)?.bubble.content : null })),
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
      if (this.editor) this.editPointerDown(pointer);
      else this.controller.walkTo(screenToWorld(pointer.worldX, pointer.worldY));
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => this.editPointerMove(pointer));
    this.input.on(Phaser.Input.Events.POINTER_UP, () => this.editPointerUp());
    this.input.on(Phaser.Input.Events.GAME_OUT, () => this.editPointerUp());

    // Decorating with a mouse: right click turns the piece, a wheel-button
    // click takes it out. Listening on the canvas itself means clicks outside
    // the game never touch the layout (auxclick needs press and release on
    // the same element). Outside edit mode nothing is intercepted, so the
    // browser menu and middle-click scrolling behave as usual.
    const canvas = this.game.canvas;
    const onContextMenu = (e: MouseEvent) => {
      if (!this.editor) return;
      e.preventDefault();
      // Touch long-press also opens a context menu; touch keeps the buttons.
      const type = (e as PointerEvent).pointerType;
      if (type && type !== 'mouse') return;
      this.editShortcut('rotate', e);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (this.editor && e.button === 1) e.preventDefault(); // no autoscroll
    };
    const onAuxClick = (e: MouseEvent) => {
      if (!this.editor || e.button !== 1) return;
      e.preventDefault();
      this.editShortcut('remove', e);
    };
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('auxclick', onAuxClick);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('auxclick', onAuxClick);
    });
  }

  /**
   * Right click / wheel-button click while decorating: acts on the selected
   * piece, or, with nothing selected, on the piece under the pointer (which
   * becomes selected). Ignored mid-drag. Refusals snap nothing: the editor
   * only applies valid changes, and the reason is reported.
   */
  private editShortcut(kind: 'rotate' | 'remove', e: MouseEvent): void {
    const editor = this.editor;
    if (!editor || this.drag) return;
    let uid = editor.selected?.uid ?? null;
    if (!uid) {
      const rect = this.game.canvas.getBoundingClientRect();
      const gx = ((e.clientX - rect.left) * this.scale.width) / rect.width;
      const gy = ((e.clientY - rect.top) * this.scale.height) / rect.height;
      const p = this.cameras.main.getWorldPoint(gx, gy);
      uid = this.pick({ worldX: p.x, worldY: p.y });
      if (!uid) return;
      editor.select(uid);
    }
    const result = kind === 'rotate' ? editor.rotate(uid) : editor.remove(uid);
    if (!result.ok) this.onEditReject?.(result.error);
    this.drawSelection(null);
  }

  // ---------------------------------------------------------------- furniture

  /**
   * (Re)creates furniture sprites for a layout and points the lamp/screen
   * lights at their new spots. Used on load and on every edit change.
   * Collision and pathfinding are rebuilt when the layout is applied
   * (scene restart), since the character doesn't move while editing.
   */
  private renderFurniture(list: readonly { uid: string; placement: FurniturePlacement }[]): void {
    const theme = THEMES[this.themeId];
    for (const f of this.furniture.values()) f.image.destroy();
    this.furniture.clear();
    this.sortables = this.sortables.filter((s) => !(s instanceof FurnitureItem));
    list.forEach(({ uid, placement }, i) => {
      const def = FURNITURE[placement.id];
      const frame = spriteFrame(def, placement.facing);
      const s = worldToScreen(placement.x, placement.y);
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      const image = this.add
        .image(x, y, ensureFurnitureTexture(this, def.id, theme, placement.facing))
        .setOrigin(frame.anchorX / frame.width, frame.anchorY / frame.height);
      let sortable: FurnitureItem | null = null;
      if (!def.blocking) {
        // Flat decor (rugs, cushions) is always under characters.
        image.setDepth(DEPTH.floorDecor + i);
      } else {
        const left = x - frame.anchorX;
        const top = y - frame.anchorY;
        const rect = footprint({ type: placement.id, x: placement.x, y: placement.y, facing: placement.facing });
        sortable = new FurnitureItem(rect, [left, top, left + frame.width, top + frame.height], image);
        this.sortables.push(sortable);
      }
      this.furniture.set(uid, { image, sortable, placement });
    });
    const placements = list.map((l) => l.placement);
    this.lighting.setSources(
      placements.flatMap((p) => lightOf(FURNITURE[p.id], p.x, p.y, p.facing) ?? []),
      placements.flatMap((p) => screenOf(FURNITURE[p.id], p.x, p.y, p.facing) ?? []),
    );
    if (this.player) this.sortDepth();
  }

  /** Moves one sprite (drag preview) without touching the editor's layout. */
  private placeSprite(uid: string, x: number, y: number): void {
    const f = this.furniture.get(uid);
    if (!f) return;
    const frame = spriteFrame(FURNITURE[f.placement.id], f.placement.facing);
    const s = worldToScreen(x, y);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    f.image.setPosition(sx, sy);
    if (f.sortable) {
      f.sortable.footprint = { ...f.sortable.footprint, x, y };
      f.sortable.bounds = [sx - frame.anchorX, sy - frame.anchorY, sx - frame.anchorX + frame.width, sy - frame.anchorY + frame.height];
    }
  }

  /**
   * Starts decorating: the character stops, clicks select/drag furniture.
   * The editor holds the draft; this scene only draws it. `onReject` is told
   * when a drop lands somewhere invalid (the piece snaps back).
   */
  startEdit(editor: LayoutEditor, onReject: (error: LayoutError) => void): void {
    this.stopEdit();
    this.editor = editor;
    this.onEditReject = onReject;
    this.controller.stop();
    this.player.setMotion(0, 0);
    this.setPeopleVisible(false);
    const draw = () => {
      this.renderFurniture(
        editor.items.map((i: EditItem) => ({ uid: i.uid, placement: { id: i.type, x: i.x, y: i.y, facing: i.facing } })),
      );
      this.drawSelection(null);
    };
    this.editUnsubscribe = editor.subscribe(draw);
    draw();
  }

  stopEdit(): void {
    this.editUnsubscribe?.();
    this.editUnsubscribe = null;
    this.editor = null;
    this.drag = null;
    this.selection?.clear();
    this.setPeopleVisible(true);
  }

  /**
   * Decorating shows just the room: every character, name tag and speech
   * bubble is hidden on this screen only. Nothing is destroyed or
   * disconnected; other people keep moving (hidden) and see us as usual.
   */
  private setPeopleVisible(visible: boolean): void {
    this.player?.setVisible(visible);
    if (!visible) this.bubble?.hide();
    else if (this.shownChat) this.bubble.show(this.shownChat.message.content);
    for (const r of this.remotes.values()) {
      r.avatar.setVisible(visible);
      if (!visible) r.bubble.hide();
    }
  }


  private floorPoint(pointer: Phaser.Input.Pointer): Vec2 {
    return screenToWorld(pointer.worldX, pointer.worldY);
  }

  /** Topmost furniture under the pointer (by visible pixels), tall pieces first, rugs last. */
  private pick(pointer: { worldX: number; worldY: number }): string | null {
    const order = [...this.furniture.entries()].sort((a, b) => b[1].image.depth - a[1].image.depth);
    for (const [uid, f] of order) {
      const img = f.image;
      const lx = Math.floor(pointer.worldX - (img.x - img.displayOriginX));
      const ly = Math.floor(pointer.worldY - (img.y - img.displayOriginY));
      if (lx < 0 || ly < 0 || lx >= img.width || ly >= img.height) continue;
      if ((this.textures.getPixelAlpha(lx, ly, img.texture.key) ?? 0) > 0) return uid;
    }
    return null;
  }

  private editPointerDown(pointer: Phaser.Input.Pointer): void {
    const editor = this.editor;
    if (!editor) return;
    const uid = this.pick(pointer);
    editor.select(uid);
    const item = uid ? editor.items.find((i) => i.uid === uid) : null;
    if (uid && item) {
      const p = this.floorPoint(pointer);
      this.drag = { uid, grab: { x: p.x - item.x, y: p.y - item.y }, start: { x: item.x, y: item.y }, cur: { x: item.x, y: item.y } };
    }
    this.drawSelection(null);
  }

  private editPointerMove(pointer: Phaser.Input.Pointer): void {
    const { editor, drag } = this;
    if (!editor || !drag || !pointer.isDown) return;
    const p = this.floorPoint(pointer);
    const x = snap(p.x - drag.grab.x);
    const y = snap(p.y - drag.grab.y);
    if (x === drag.cur.x && y === drag.cur.y) return;
    drag.cur = { x, y };
    this.placeSprite(drag.uid, x, y);
    this.sortDepth();
    this.drawSelection(editor.check(drag.uid, x, y) === null ? 'ok' : 'bad');
  }

  private editPointerUp(): void {
    const { editor, drag } = this;
    this.drag = null;
    if (!editor || !drag) return;
    if (drag.cur.x === drag.start.x && drag.cur.y === drag.start.y) return;
    const result = editor.move(drag.uid, drag.cur.x, drag.cur.y);
    if (!result.ok) {
      // Snap back to where it was and say why.
      this.placeSprite(drag.uid, drag.start.x, drag.start.y);
      this.sortDepth();
      this.drawSelection(null);
      this.onEditReject?.(result.error);
    }
  }

  /** Outline of the selected piece's footprint on the floor: pink normally, green/red while dragging. */
  private drawSelection(state: 'ok' | 'bad' | null): void {
    const g = this.selection;
    g.clear();
    for (const f of this.furniture.values()) f.image.setAlpha(1);
    const sel = this.editor?.selected;
    if (!sel) return;
    const pos = this.drag?.uid === sel.uid ? this.drag.cur : sel;
    const r = footprint({ ...sel, x: pos.x, y: pos.y });
    const color = state === 'bad' ? 0xe5484d : state === 'ok' ? 0x4caf7a : 0xff7fae;
    const pts = [worldToScreen(r.x, r.y), worldToScreen(r.x + r.w, r.y), worldToScreen(r.x + r.w, r.y + r.h), worldToScreen(r.x, r.y + r.h)];
    g.fillStyle(color, 0.25).lineStyle(1, color, 1).beginPath();
    pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.closePath().fillPath().strokePath();
    if (state === 'bad') this.furniture.get(sel.uid)?.image.setAlpha(0.6);
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
    for (const r of this.remotes.values()) {
      r.avatar.setZoom(zoom);
      r.bubble.setZoom(zoom);
    }
  }
}
