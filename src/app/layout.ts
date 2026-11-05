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
