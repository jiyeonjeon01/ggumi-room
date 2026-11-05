import Phaser from 'phaser';
import type { ThemeId } from './art/themes';
import { TimeOfDayClock, type TimeMode } from './environment/TimeOfDayClock';
import type { Period } from './environment/timeOfDay';
import type { RoomData } from './room/roomData';
import { ROOM_SCENE, RoomScene, type RoomSceneData } from './scenes/RoomScene';

/** Small handle React uses to talk to the game. No per-frame data crosses it. */
export interface GameHandle {
  setTheme(theme: ThemeId): void;
  setTimeMode(mode: TimeMode): void;
  destroy(): void;
}

export interface GameCallbacks {
  /** Fires on start and whenever the time-of-day period changes. */
  onPeriodChange?: (period: Period) => void;
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

  const data: RoomSceneData = { room, theme, period: clock.period };
  game.scene.add(ROOM_SCENE, RoomScene, true, data);

  if (import.meta.env.DEV) {
    // Inspection hook for local verification (not included in production builds).
    (window as unknown as { __ggumiroom?: unknown }).__ggumiroom = {
      state: () => scene()?.debugState(),
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
      if (!s || !s.sys.isActive()) return;
      const restart: RoomSceneData = { room, theme: next, player: s.getPlayerState(), period: clock.period };
      s.scene.restart(restart);
    },
    setTimeMode(mode) {
      clock.setMode(mode);
    },
    destroy() {
      if (import.meta.env.DEV) delete (window as unknown as { __ggumiroom?: unknown }).__ggumiroom;
      clock.destroy();
      game.destroy(true);
    },
  };
}
