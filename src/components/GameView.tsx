import { useEffect, useRef } from 'react';
import type { ThemeId } from '../game/art/themes';
import { createGame, type GameHandle } from '../game/createGame';
import type { TimeMode } from '../game/environment/TimeOfDayClock';
import type { Period } from '../game/environment/timeOfDay';
import type { RoomData } from '../game/room/roomData';

interface Props {
  room: RoomData;
  theme: ThemeId;
  timeMode: TimeMode;
  onPeriodChange?: (period: Period) => void;
}

/**
 * Hosts the Phaser canvas. The game is created once per mounted room and
 * destroyed on unmount; prop changes are forwarded through the GameHandle
 * instead of re-creating the game. React never re-renders per game frame.
 */
export function GameView({ room, theme, timeMode, onPeriodChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GameHandle | null>(null);
  const themeRef = useRef(theme);
  const timeModeRef = useRef(timeMode);
  const periodCallbackRef = useRef(onPeriodChange);
  useEffect(() => {
    periodCallbackRef.current = onPeriodChange;
  }, [onPeriodChange]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handle = createGame(el, room, themeRef.current, timeModeRef.current, {
      onPeriodChange: (p) => periodCallbackRef.current?.(p),
    });
    handleRef.current = handle;
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, [room]);

  useEffect(() => {
    if (themeRef.current === theme) return;
    themeRef.current = theme;
    handleRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (timeModeRef.current === timeMode) return;
    timeModeRef.current = timeMode;
    handleRef.current?.setTimeMode(timeMode);
  }, [timeMode]);

  return <div ref={containerRef} className="absolute inset-0 overflow-hidden" />;
}
