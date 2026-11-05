import { useEffect, useState, type ReactNode } from 'react';
import { useLayoutMode, useStoredFlag } from '../app/layout';
import { Modal } from './ui';

interface Props {
  /** The game stage (section with the Phaser canvas). */
  children: ReactNode;
  /** Left panel content ("내 정보"). */
  my: (close?: () => void) => ReactNode;
  /** Right panel content ("친구"). */
  friends: (close?: () => void) => ReactNode;
  /** Pending incoming friend requests, shown as a badge. */
  badge: number;
  /** Keyboard hints under the game (desktop/tablet only). */
  footer: ReactNode;
}

/**
 * Room page around the game:
 * - desktop (>= 1280): left "내 정보" (260px) and right "친구" (300px) side
 *   panels, each collapsible on its own; state remembered in localStorage.
 * - tablet (768-1279): icon rail on the left, panels slide over the game.
 * - mobile (< 768): bottom tab bar under the game, panels as bottom sheets.
 * The game area flexes; Phaser re-fits the room on resize.
 */
export function RoomLayout({ children, my, friends, badge, footer }: Props) {
  const mode = useLayoutMode();
  const [leftCollapsed, setLeftCollapsed] = useStoredFlag('ggumi:ui:left-collapsed', false);
  const [rightCollapsed, setRightCollapsed] = useStoredFlag('ggumi:ui:right-collapsed', false);
  const [open, setOpen] = useState<'my' | 'friends' | null>(null);
  const close = () => setOpen(null);

  // Overlays from a smaller layout don't carry over to a bigger one.
  useEffect(() => setOpen(null), [mode]);

  if (mode === 'desktop') {
    return (
      <>
        <div className="flex min-h-0 flex-1 gap-3">
          <SidePanel side="left" title="내 정보" icon="👤" width="w-[260px]" collapsed={leftCollapsed} onToggle={() => setLeftCollapsed(!leftCollapsed)}>
            {my()}
          </SidePanel>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
          <SidePanel side="right" title="친구" icon="👥" width="w-[300px]" badge={badge} collapsed={rightCollapsed} onToggle={() => setRightCollapsed(!rightCollapsed)}>
            {friends()}
          </SidePanel>
        </div>
        {footer}
      </>
    );
  }

  if (mode === 'tablet') {
    return (
      <>
        <div className="flex min-h-0 flex-1 gap-3">
          <nav aria-label="메뉴" className="flex w-14 shrink-0 flex-col items-center gap-2 rounded-[28px] bg-white/70 py-3 shadow-sm ring-1 ring-blush-200">
            <RailButton icon="👤" label="내 정보" expanded={open === 'my'} onClick={() => setOpen(open === 'my' ? null : 'my')} />
            <RailButton icon="👥" label="친구" badge={badge} expanded={open === 'friends'} onClick={() => setOpen(open === 'friends' ? null : 'friends')} />
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </div>
        {footer}
        {open && (
          <Drawer side={open === 'my' ? 'left' : 'right'} title={open === 'my' ? '내 정보' : '친구'} onClose={close}>
            {open === 'my' ? my(close) : friends(close)}
          </Drawer>
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <nav aria-label="메뉴" className="grid shrink-0 grid-cols-2 gap-1 rounded-full bg-white/70 p-1 shadow-sm ring-1 ring-blush-200">
        <TabButton icon="👤" label="내 정보" expanded={open === 'my'} onClick={() => setOpen('my')} />
        <TabButton icon="👥" label="친구" badge={badge} expanded={open === 'friends'} onClick={() => setOpen('friends')} />
      </nav>
      {open && (
        <Modal title={open === 'my' ? '내 정보' : '친구'} onClose={close}>
          {open === 'my' ? my(close) : friends(close)}
        </Modal>
      )}
    </>
  );
}

function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-blush-500 px-1.5 text-[11px] leading-5 text-white" aria-label={`받은 친구 요청 ${count}개`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

function SidePanel({
  side,
  title,
  icon,
  width,
  badge = 0,
  collapsed,
  onToggle,
  children,
}: {
  side: 'left' | 'right';
  title: string;
  icon: string;
  width: string;
  badge?: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `panel-${side}`;
  if (collapsed) {
    return (
      <aside id={panelId} aria-label={title} className="flex w-12 shrink-0 flex-col items-center rounded-[28px] bg-white/70 py-3 shadow-sm ring-1 ring-blush-200">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-controls={panelId}
          title={`${title} 펼치기`}
          className="flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-plum-500 hover:bg-blush-100"
        >
          <span aria-hidden className="text-lg">{icon}</span>
          <span className="text-[11px] [writing-mode:vertical-rl]">{title}</span>
          <span className="sr-only">펼치기</span>
          {badge > 0 && <Badge count={badge} />}
        </button>
      </aside>
    );
  }
  return (
    <aside
      id={panelId}
      aria-label={title}
      className={`flex ${width} shrink-0 flex-col rounded-[28px] bg-white/80 p-4 shadow-[0_8px_30px_-12px_rgba(122,74,104,0.35)] ring-4 ring-white backdrop-blur`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg text-plum-700">
          <span aria-hidden className="mr-1">{icon}</span>
          {title}
          <Badge count={badge} />
        </h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded
          aria-controls={panelId}
          title={`${title} 접기`}
          className="rounded-full px-2 py-0.5 text-plum-500 hover:bg-blush-100"
        >
          <span aria-hidden>{side === 'left' ? '«' : '»'}</span>
          <span className="sr-only">접기</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
    </aside>
  );
}

function RailButton({ icon, label, badge = 0, expanded, onClick }: { icon: string; label: string; badge?: number; expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      title={label}
      className={`relative flex w-11 flex-col items-center rounded-2xl py-1.5 text-[11px] ${expanded ? 'bg-blush-400 text-white shadow' : 'text-plum-500 hover:bg-blush-100'}`}
    >
      <span aria-hidden className="text-lg">{icon}</span>
      {label}
      {badge > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-blush-500 px-1 text-[11px] leading-5 text-white" aria-label={`받은 친구 요청 ${badge}개`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

function TabButton({ icon, label, badge = 0, expanded, onClick }: { icon: string; label: string; badge?: number; expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className="flex items-center justify-center rounded-full px-3 py-2 text-sm text-plum-500 hover:bg-blush-100"
    >
      <span aria-hidden className="mr-1">{icon}</span>
      {label}
      <Badge count={badge} />
    </button>
  );
}

/** Tablet slide-over panel. Esc or the backdrop closes it. */
function Drawer({ side, title, onClose, children }: { side: 'left' | 'right'; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 bg-plum-900/20" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={`absolute inset-y-3 flex w-[320px] max-w-[85vw] flex-col rounded-[28px] bg-cream p-4 shadow-xl ring-4 ring-white ${side === 'left' ? 'left-3' : 'right-3'}`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg text-plum-700">{title}</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full px-2 text-xl text-plum-500 hover:bg-blush-100">
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
      </aside>
    </div>
  );
}
