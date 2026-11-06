import Phaser from 'phaser';
import type { ThemeId } from './art/themes';
import { createChatMessage, LocalChatTransport, normalizeChat, type ChatTransport } from './chat/chat';
import { LayoutEditor } from './core/layoutEditor';
import type { LayoutError, LayoutItem } from './core/placement';
import { toLayout, toPlacements } from './room/roomData';
import { TimeOfDayClock, type TimeMode } from './environment/TimeOfDayClock';
import type { Period } from './environment/timeOfDay';
import type { RoomData } from './room/roomData';
import { ROOM_SCENE, RoomScene, type RemoteMember, type RoomSceneData } from './scenes/RoomScene';
import type { MoveState } from './net/motion';

export type { RemoteMember } from './scenes/RoomScene';
export type { MoveState } from './net/motion';

/** Live updates about other people in the room, fed by the realtime connection. */
export interface RemoteControls {
  /** Everyone else, as the server lists them right after joining. */
  reset(members: readonly RemoteMember[]): void;
  join(member: RemoteMember): void;
  move(id: string, state: MoveState): void;
  leave(id: string): void;
  say(id: string, text: string): void;
}

/** Small handle React uses to talk to the game. No per-frame data crosses it. */
export interface GameHandle {
  setTheme(theme: ThemeId): void;
  setTimeMode(mode: TimeMode): void;
  /** Sends a chat message as the local player. Returns false if it was empty after trimming. */
  sendChat(text: string): boolean;
  /** Stops keyboard movement (and key capture) while a text input is focused. */
  setKeyboardEnabled(enabled: boolean): void;
  /**
   * Starts decorating the room. Returns the editor holding the draft; the
   * game draws it live. `onReject` hears about drops that were refused.
   */
  startEdit(onReject: (error: LayoutError) => void): LayoutEditor | null;
  /** Ends decorating: shows `layout` (after a save) or the layout from before editing. */
  endEdit(layout: readonly LayoutItem[] | null): void;
  /** Other people in the room. */
  remote: RemoteControls;
  /** Where the local player stands (sent when joining a room). */
  getPlayer(): { x: number; y: number; f: string } | null;
  /** Server correction of the local player's position. */
  fixLocal(x: number, y: number): void;
  /** Makes the next movement report go out (after (re)joining). */
  resendPosition(): void;
  /** Someone (the owner) saved a new layout: rebuild the room with it (ignored while decorating). */
  applyLayout(layout: readonly LayoutItem[]): void;
  destroy(): void;
}

export interface GameCallbacks {
  /** Fires on start and whenever the time-of-day period changes. */
  onPeriodChange?: (period: Period) => void;
  /** The local player moved (throttled to ~10 per second while walking). */
  onLocalMove?: (state: MoveState) => void;
  /** The local player said something (already shown locally). */
  onLocalSay?: (text: string) => void;
}

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function createGame(
  parent: HTMLElement,
  room: RoomData,
  theme: ThemeId,
  timeMode: TimeMode,
  callbacks: GameCallbacks = {},
): GameHandle {
  const game = new Phaser.Game({
    // WebGL when available; Phaser falls back to Canvas 2D otherwise.
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    antialias: false,
    backgroundColor: '#00000000',
    transparent: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: parent.clientWidth || 800,
      height: parent.clientHeight || 600,
    },
    input: { keyboard: { target: window } },
    banner: false,
    audio: { noAudio: true },
    scene: [],
  });

  // The clock outlives scene restarts (theme switches) and is the single
  // source of truth for the current period.
  const clock = new TimeOfDayClock();
  clock.setMode(timeMode);
  const scene = () => game.scene.getScene<RoomScene>(ROOM_SCENE);
  clock.onChange((period) => {
    const s = scene();
    if (s?.sys.isActive()) s.applyPeriod(period);
    callbacks.onPeriodChange?.(period);
  });
  callbacks.onPeriodChange?.(clock.period);

  // Chat: today messages loop back inside the browser. To go online, pass a
  // WebSocketChatTransport here instead; the bubbles only see ChatMessages.
  const chat: ChatTransport = new LocalChatTransport();
  const localPlayerId = room.owner;
  chat.onMessage((message) => {
    const s = scene();
    if (s?.sys.isActive()) s.showChat(message);
  });

  // Current room and theme: a saved layout or a theme switch replaces them,
  // and every scene restart starts from these (never the initial props).
  let currentRoom = room;
  let currentTheme = theme;
  let editing = false;
  let keyboardWanted = true;
  const applyKeyboard = () => {
    // Off while decorating (the editor uses its own keys) or while typing.
    // The manager also stops calling preventDefault on captured keys, so
    // W/A/S/D and arrows type normally into inputs.
    const on = keyboardWanted && !editing;
    if (game.input.keyboard) game.input.keyboard.enabled = on;
    scene()?.setKeyboardEnabled(on);
  };
  const onLocalMove = callbacks.onLocalMove;
  const restart = (s: RoomScene) =>
    s.scene.restart({
      room: currentRoom,
      theme: currentTheme,
      player: s.getPlayerState(),
      period: clock.period,
      chat: s.getChatState(),
      remotes: s.getRemotes(),
      onLocalMove,
    } satisfies RoomSceneData);
  // Remote updates arriving while the scene restarts are kept until it's back.
  const active = () => {
    const s = scene();
    return s?.sys.isActive() ? s : null;
  };
  let pendingRemotes: RemoteMember[] | null = null;

  const data: RoomSceneData = { room, theme, period: clock.period, onLocalMove };
  game.scene.add(ROOM_SCENE, RoomScene, true, data);
  // The scene object survives restarts, so this runs after every (re)create.
  scene()?.events.on(Phaser.Scenes.Events.CREATE, () => {
    if (!pendingRemotes) return;
    scene()?.setRemotes(pendingRemotes);
    pendingRemotes = null;
  });

  if (import.meta.env.DEV) {
    // Inspection hook for local verification (not included in production builds).
    (window as unknown as { __ggumiroom?: unknown }).__ggumiroom = {
      state: () => scene()?.debugState(),
      keyboardEnabled: () => game.input.keyboard?.enabled ?? false,
      worldToCanvas: (x: number, y: number) => scene()?.debugWorldToCanvas({ x, y }),
      renderer: () => (game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas'),
      clock: {
        state: () => ({ mode: clock.timeMode, period: clock.period }),
        /** Pretend real time is `ms` ahead (auto mode testing). */
        setOffset: (ms: number, refresh?: boolean) => clock.setOffset(ms, refresh),
      },
    };
  }

  return {
    setTheme(next) {
      const s = scene();
      if (!s || !s.sys.isActive() || editing) return;
      currentTheme = next;
      restart(s);
    },
    setTimeMode(mode) {
      clock.setMode(mode);
    },
    sendChat(text) {
      const content = normalizeChat(text);
      if (!content) return false;
      chat.send(createChatMessage(localPlayerId, content));
      callbacks.onLocalSay?.(content);
      return true;
    },
    setKeyboardEnabled(enabled) {
      keyboardWanted = enabled;
      applyKeyboard();
    },
    startEdit(onReject) {
      const s = scene();
      if (!s || !s.sys.isActive() || editing) return null;
      editing = true;
      applyKeyboard();
      // The characters are hidden while decorating, so (like the server) the
      // editor doesn't keep furniture off ours; the room moves it to a free
      // spot of the main floor after saving.
      const editor = new LayoutEditor(toLayout(currentRoom.furniture));
      s.startEdit(editor, onReject);
      return editor;
    },
    endEdit(layout) {
      const s = scene();
      if (!editing) return;
      editing = false;
      if (layout) currentRoom = { ...currentRoom, furniture: toPlacements(layout) };
      if (s?.sys.isActive()) {
        s.stopEdit();
        // A restart rebuilds furniture, collision, pathfinding and lights from
        // the layout, and moves the character off any furniture now under it.
        restart(s);
      }
      applyKeyboard();
    },
    remote: {
      reset(members) {
        const s = active();
        if (s) s.setRemotes(members);
        else pendingRemotes = [...members];
      },
      join(member) {
        active()?.addRemote(member);
      },
      move(id, state) {
        active()?.moveRemote(id, state);
      },
      leave(id) {
        active()?.removeRemote(id);
      },
      say(id, text) {
        active()?.sayRemote(id, text);
      },
    },
    getPlayer() {
      const p = active()?.getPlayerState();
      return p ? { x: p.pos.x, y: p.pos.y, f: p.facing } : null;
    },
    fixLocal(x, y) {
      active()?.fixLocal(x, y);
    },
    resendPosition() {
      active()?.resendPosition();
    },
    applyLayout(layout) {
      currentRoom = { ...currentRoom, furniture: toPlacements(layout) };
      const s = active();
      if (s && !editing) restart(s);
    },
    destroy() {
      if (import.meta.env.DEV) delete (window as unknown as { __ggumiroom?: unknown }).__ggumiroom;
      clock.destroy();
      chat.destroy();
      game.destroy(true);
    },
  };
}
