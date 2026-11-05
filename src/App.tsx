import { useState } from 'react';
import { GameView } from './components/GameView';
import { THEME_IDS, THEMES, type ThemeId } from './game/art/themes';
import { isWebGLAvailable } from './game/createGame';
import type { TimeMode } from './game/environment/TimeOfDayClock';
import { PERIOD_LABEL, PERIODS, type Period } from './game/environment/timeOfDay';
import { DEMO_ROOM } from './game/room/roomData';

const THEME_EMOJI: Record<ThemeId, string> = { pastel: '🎀', galaxy: '🪐', plant: '🌿' };
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const PERIOD_EMOJI: Record<Period, string> = { dawn: '🌅', day: '☀️', sunset: '🌇', night: '🌙' };
const webgl = isWebGLAvailable();
/** Developer tools are shown in dev builds, or in production with ?debug. */
const showDevTools = import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug');

export default function App() {
  const [theme, setTheme] = useState<ThemeId>(DEMO_ROOM.theme);
  const [timeMode, setTimeMode] = useState<TimeMode>('auto');
  const [period, setPeriod] = useState<Period | null>(null);
  const room = DEMO_ROOM;

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-blush-50 via-cream to-lavender-100">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-2xl tracking-wide text-plum-700 sm:text-3xl">
              꾸미룸 <span className="ml-1.5 align-middle text-sm tracking-wide text-blush-400">Ggumiroom</span>
            </h1>
            <p className="text-xs text-plum-500 sm:text-sm">나만의 작은 픽셀 방에 놀러 오세요</p>
          </div>
        </div>

        <nav aria-label="방 테마" className="flex gap-1 rounded-full bg-white/70 p-1 shadow-sm ring-1 ring-blush-200">
          {THEME_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTheme(id)}
              aria-pressed={theme === id}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                theme === id ? 'bg-blush-400 text-white shadow' : 'text-plum-500 hover:bg-blush-100'
              }`}
            >
              <span aria-hidden className="mr-1">{THEME_EMOJI[id]}</span>
              {THEMES[id].label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:px-8 sm:pb-6">
        <section
          className="relative min-h-[320px] flex-1 overflow-hidden rounded-[28px] shadow-[0_8px_30px_-12px_rgba(122,74,104,0.35)] ring-4 ring-white transition-colors duration-500"
          style={{ backgroundColor: hex(THEMES[theme].backdrop) }}
        >
          <GameView room={room} theme={theme} timeMode={timeMode} onPeriodChange={setPeriod} />

          <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-2xl bg-white/85 px-3 py-2 shadow-sm ring-1 ring-blush-200 backdrop-blur">
            <span aria-hidden>{THEME_EMOJI[theme]}</span>
            <div className="leading-tight">
              <p className="text-sm tracking-wide text-plum-700">{room.name}</p>
              <p className="text-[11px] text-plum-500">{THEMES[theme].label} · 개인룸</p>
            </div>
            {period && (
              <span
                data-testid="period-badge"
                className="ml-1 rounded-full bg-lavender-100 px-2 py-0.5 text-[11px] text-plum-700"
              >
                <span aria-hidden className="mr-0.5">{PERIOD_EMOJI[period]}</span>
                {PERIOD_LABEL[period]}
              </span>
            )}
          </div>

          {showDevTools && <TimeDevPanel mode={timeMode} onChange={setTimeMode} />}

          {!webgl && (
            <p className="absolute bottom-4 left-4 rounded-xl bg-white/90 px-3 py-1.5 text-xs text-plum-500 ring-1 ring-blush-200">
              WebGL을 쓸 수 없어 Canvas 모드로 실행 중이에요.
            </p>
          )}
        </section>

        <footer className="flex flex-wrap items-center justify-center gap-2 text-xs text-plum-500 sm:text-sm">
          <Hint keys={['클릭']} label="그 자리로 이동" />
          <Hint keys={['↑', '↓', '←', '→']} label="또는" />
          <Hint keys={['W', 'A', 'S', 'D']} label="로 걷기" />
          <Hint keys={['Enter']} label="채팅" />
        </footer>
      </main>
    </div>
  );
}

/** Developer-only time-of-day override. Visually separate from the player UI. */
function TimeDevPanel({ mode, onChange }: { mode: TimeMode; onChange: (m: TimeMode) => void }) {
  const options: { id: TimeMode; label: string }[] = [
    { id: 'auto', label: '자동 (KST)' },
    ...PERIODS.map((p) => ({ id: p, label: PERIOD_LABEL[p] })),
  ];
  return (
    <fieldset className="absolute bottom-16 right-3 rounded-lg sm:bottom-3 border border-dashed border-plum-500/60 bg-plum-900/80 px-2 pb-2 pt-0.5 font-mono text-[11px] text-white shadow-lg">
      <legend className="rounded bg-plum-900 px-1 text-[10px] uppercase tracking-wider text-white/80">dev · 시간대</legend>
      <div className="flex gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={mode === o.id}
            onClick={() => onChange(o.id)}
            className={`rounded px-1.5 py-0.5 ${mode === o.id ? 'bg-white text-plum-900' : 'text-white/80 hover:bg-white/15'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="min-w-6 rounded-md bg-white px-1.5 py-0.5 text-center font-sans text-plum-700 shadow-[0_2px_0_0] shadow-blush-200 ring-1 ring-blush-200"
        >
          {k}
        </kbd>
      ))}
      <span className="mr-2">{label}</span>
    </span>
  );
}

/** Tiny iso cube logo, drawn as crisp SVG pixels. */
function Logo() {
  return (
    <svg viewBox="0 0 16 16" className="h-10 w-10 drop-shadow-sm" shapeRendering="crispEdges" aria-hidden>
      <path fill="#f7a8c8" d="M8 1l7 3.5v7L8 15l-7-3.5v-7z" />
      <path fill="#c9a8f0" d="M8 8l7-3.5v7L8 15z" />
      <path fill="#fff1f6" d="M8 1l7 3.5L8 8 1 4.5z" />
      <path fill="#ff7fae" d="M6 5h1v1H6zM9 5h1v1H9zM6 6h4v1H6zM7 7h2v1H7z" />
    </svg>
  );
}
