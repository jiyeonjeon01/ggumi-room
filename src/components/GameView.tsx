import { useEffect, useRef } from 'react';
import type { ThemeId } from '../game/art/themes';
import type { LayoutEditor } from '../game/core/layoutEditor';
import type { LayoutError, LayoutItem } from '../game/core/placement';
import { createGame, type GameHandle } from '../game/createGame';
import type { TimeMode } from '../game/environment/TimeOfDayClock';
import type { Period } from '../game/environment/timeOfDay';
import type { RoomData } from '../game/room/roomData';
import { ChatBar } from './ChatBar';

/** True for elements that take typed text (where WASD/arrows must not move the character). */
function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/** What the page can ask of the running game (decorating). */
export interface GameControls {
  startEdit(onReject: (error: LayoutError) => void): LayoutEditor | null;
  endEdit(layout: readonly LayoutItem[] | null): void;
}

interface Props {
  room: RoomData;
  /** Filled with the game's controls while it runs. */
  controlsRef?: { current: GameControls | null };
  /** Decorating: hide the chat bar (the character can't talk or walk meanwhile). */
  editing?: boolean;
  theme: ThemeId;
  timeMode: TimeMode;
  onPeriodChange?: (period: Period) => void;
}

/**
 * Hosts the Phaser canvas. The game is created once per mounted room and
 * destroyed on unmount; prop changes are forwarded through the GameHandle
 * instead of re-creating the game. React never re-renders per game frame.
 */
export function GameView({ room, theme, timeMode, onPeriodChange, controlsRef, editing = false }: Props) {
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
    if (controlsRef) controlsRef.current = { startEdit: (r) => handle.startEdit(r), endEdit: (l) => handle.endEdit(l) };

    // Any text field on the page (chat, friend search, forms) pauses game
    // keys, so typing never walks the character. focusout is read on the next
    // tick, once focus has settled on its new element.
    const sync = () => handle.setKeyboardEnabled(!isTextEntry(document.activeElement));
    const onFocusOut = () => window.setTimeout(sync, 0);
    // Phaser cancels the canvas's default pointer behavior, so clicking the
    // room wouldn't move focus off a text field and WASD would keep typing
    // there. Clicking the game hands the keyboard back to the game.
    const onPointerDown = () => {
      const active = document.activeElement;
      if (isTextEntry(active) && active instanceof HTMLElement) active.blur();
    };
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', onFocusOut);
    el.addEventListener('pointerdown', onPointerDown, true);
    sync();
    return () => {
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', onFocusOut);
      el.removeEventListener('pointerdown', onPointerDown, true);
      handle.destroy();
      handleRef.current = null;
      if (controlsRef) controlsRef.current = null;
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

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 overflow-hidden" />
      {!editing && <ChatBar onSend={(text) => handleRef.current?.sendChat(text) ?? false} />}
    </>
  );
}
