import { useEffect, useState } from 'react';

/** Room page layouts: desktop >= 1280 (Tailwind xl), tablet 768-1279 (md), mobile < 768. */
export type LayoutMode = 'desktop' | 'tablet' | 'mobile';

function current(): LayoutMode {
  if (window.matchMedia('(min-width: 1280px)').matches) return 'desktop';
  if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
  return 'mobile';
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState(current);
  useEffect(() => {
    const queries = ['(min-width: 1280px)', '(min-width: 768px)'].map((q) => window.matchMedia(q));
    const onChange = () => setMode(current());
    queries.forEach((q) => q.addEventListener('change', onChange));
    return () => queries.forEach((q) => q.removeEventListener('change', onChange));
  }, []);
  return mode;
}

/**
 * A boolean UI preference kept in localStorage (e.g. a collapsed panel).
 * Only layout choices go here, never anything about the account or session.
 */
export function useStoredFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? initial : v === '1';
    } catch {
      return initial;
    }
  });
  const set = (v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(key, v ? '1' : '0');
    } catch {
      /* storage unavailable: keep it for this visit only */
    }
  };
  return [value, set];
}

const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';

/** True on touch-first devices (phones, tablets): no Enter key to lean on, tap targets need room. */
export function useTouchDevice(): boolean {
  const [touch, setTouch] = useState(() => window.matchMedia(TOUCH_QUERY).matches);
  useEffect(() => {
    const q = window.matchMedia(TOUCH_QUERY);
    const onChange = () => setTouch(q.matches);
    q.addEventListener('change', onChange);
    return () => q.removeEventListener('change', onChange);
  }, []);
  return touch;
}

/**
 * The part of the layout viewport a virtual keyboard covers right now, in CSS
 * px (0 when none). iOS Safari, and Chrome on Android by default, shrink only
 * the visual viewport when the keyboard opens, so `position: fixed; bottom: 0`
 * ends up under the keyboard. `top` is where the visible area starts (the
 * page may be panned to keep the focused field in view).
 */
export interface KeyboardInset {
  top: number;
  height: number;
  bottom: number;
}

export function keyboardInset(layoutHeight: number, vv: { offsetTop: number; height: number } | null): KeyboardInset {
  if (!vv) return { top: 0, height: layoutHeight, bottom: 0 };
  const bottom = Math.max(0, Math.round(layoutHeight - vv.offsetTop - vv.height));
  return { top: Math.max(0, Math.round(vv.offsetTop)), height: Math.round(vv.height), bottom };
}

export function useKeyboardInset(): KeyboardInset {
  const read = () => keyboardInset(window.innerHeight, window.visualViewport);
  const [inset, setInset] = useState(read);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setInset((prev) => {
      const next = read();
      return prev.top === next.top && prev.height === next.height && prev.bottom === next.bottom ? prev : next;
    });
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return inset;
}
