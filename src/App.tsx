import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type RoomInfo } from './api/client';
import { AuthProvider, useAuth } from './app/auth';
import { LiveProvider } from './app/live';
import { useRoomLive } from './app/roomLive';
import { navigate, setLeaveGuard, useRoute } from './app/router';
import { FriendsProvider, useFriends } from './app/friends';
import { FriendsPanel } from './components/FriendsPanel';
import { GameView, type GameControls } from './components/GameView';
import { MyPanel } from './components/MyPanel';
import { EditBar, EditorPanel, useEditorKeys } from './components/RoomEditor';
import { RoomLayout } from './components/RoomLayout';
import { Button, Card, Modal, ToastProvider, useToast } from './components/ui';
import { THEME_IDS, THEMES, type ThemeId } from './game/art/themes';
import { isWebGLAvailable, type MoveState } from './game/createGame';
import type { TimeMode } from './game/environment/TimeOfDayClock';
import { PERIOD_LABEL, PERIODS, type Period } from './game/environment/timeOfDay';
import type { LayoutEditor } from './game/core/layoutEditor';
import { isFurnitureType, LAYOUT_ERROR_TEXT, type Facing, type LayoutItem } from './game/core/placement';
import { DEMO_ROOM, toPlacements, type RoomData } from './game/room/roomData';
import { finishAuth, LoginPage, SignupPage } from './pages/AuthPage';
import { InvitePage } from './pages/InvitePage';

const THEME_EMOJI: Record<ThemeId, string> = { pastel: '🎀', galaxy: '🪐', plant: '🌿' };
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const PERIOD_EMOJI: Record<Period, string> = { dawn: '🌅', day: '☀️', sunset: '🌇', night: '🌙' };
const webgl = isWebGLAvailable();
/** Developer tools only exist in dev builds; production (the public site) never shows them. */
const showDevTools = import.meta.env.DEV;

export default function App() {
  return (
    <AuthProvider>
      <LiveProvider>
        <ToastProvider>
          <Pages />
        </ToastProvider>
      </LiveProvider>
    </AuthProvider>
  );
}

function Pages() {
  const route = useRoute();
  const { state } = useAuth();

  // Pages that need a session send guests to log in and come back afterwards.
  useEffect(() => {
    if (route.name === 'room' && state.status === 'guest') {
      navigate(`/login?next=${encodeURIComponent(`/room/${route.id}`)}`, { replace: true });
    }
    if ((route.name === 'login' || route.name === 'signup') && state.status === 'user') {
      void finishAuth(route.next);
    }
  }, [route, state.status]);

  switch (route.name) {
    case 'home':
      if (state.status === 'user') return <MyRoomScreen />;
      return state.status === 'guest' ? <DemoScreen /> : <Loading />;
    case 'room':
      return state.status === 'user' ? <VisitRoomScreen id={route.id} /> : <Loading />;
    case 'invite':
      return (
        <Layout>
          <InvitePage token={route.token} />
        </Layout>
      );
    case 'login':
      return (
        <Layout>
          <LoginPage next={route.next} />
        </Layout>
      );
    case 'signup':
      return (
        <Layout>
          <SignupPage next={route.next} />
        </Layout>
      );
    default:
      return <NotFound />;
  }
}

// ---------------------------------------------------------------- layout

function Layout({ children, nav }: { children: ReactNode; nav?: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-gradient-to-b from-blush-50 via-cream to-lavender-100">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-8 sm:pt-6">
        <a href="/" onClick={(e) => (e.preventDefault(), navigate('/'))} className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-2xl tracking-wide text-plum-700 sm:text-3xl">
              꾸미룸 <span className="ml-1.5 align-middle text-sm tracking-wide text-blush-400">Ggumiroom</span>
            </h1>
            <p className="text-xs text-plum-500 sm:text-sm">나만의 작은 픽셀 방에 놀러 오세요</p>
          </div>
        </a>
        <div className="flex flex-wrap items-center gap-2">
          {nav}
          <AccountMenu />
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:px-8 sm:pb-6">{children}</main>
    </div>
  );
}

function AccountMenu() {
  const { state, signupCodeRequired, logout } = useAuth();
  const toast = useToast();
  if (state.status === 'loading') return null;
  if (state.status === 'guest') {
    if (state.apiDown) return <span className="text-xs text-plum-500">로그인 서버 점검 중</span>;
    return (
      <div className="flex gap-1">
        <Button variant="soft" className="px-3 py-1.5" onClick={() => navigate('/login')}>
          로그인
        </Button>
        {/* Test period (sign-up code set): don't advertise sign-up. */}
        {signupCodeRequired === false && (
          <Button className="px-3 py-1.5" onClick={() => navigate('/signup')}>
            회원가입
          </Button>
        )}
      </div>
    );
  }
  const onLogout = async () => {
    try {
      await logout();
      navigate('/', { replace: true });
    } catch {
      toast('로그아웃하지 못했어요.');
    }
  };
  return (
    <div className="flex items-center gap-1 rounded-full bg-white/70 py-1 pl-3 pr-1 shadow-sm ring-1 ring-blush-200">
      <span className="text-sm text-plum-700">{state.me.nickname}님</span>
      <Button variant="ghost" className="px-3 py-1" onClick={onLogout}>
        로그아웃
      </Button>
    </div>
  );
}

function Loading() {
  return (
    <Layout>
      <p className="py-16 text-center text-plum-500">방을 불러오는 중…</p>
    </Layout>
  );
}

function NotFound() {
  return (
    <Layout>
      <div className="mx-auto w-full max-w-sm py-6">
        <Card className="text-center">
          <h2 className="mb-2 text-xl text-plum-700">길을 잃었어요</h2>
          <p className="mb-5 text-sm text-plum-500">찾는 페이지가 없어요.</p>
          <Button onClick={() => navigate('/')}>꾸미룸으로</Button>
        </Card>
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------- rooms

/** Not logged in: the original demo room, as before (theme changes stay local). */
function DemoScreen() {
  const [theme, setTheme] = useState<ThemeId>(DEMO_ROOM.theme);
  const { signupCodeRequired } = useAuth();
  return (
    <RoomScreen
      room={DEMO_ROOM}
      theme={theme}
      onTheme={setTheme}
      subtitle={`${THEMES[theme].label} · 둘러보기`}
      banner={
        <>
          둘러보기 중이에요.
          {signupCodeRequired === false && (
            <>
              {' '}
              <b className="font-normal text-blush-500">가입하면 내 이름표와 내 방</b>이 생겨요.
            </>
          )}
        </>
      }
    />
  );
}

function useRoomInfo(path: string) {
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setError(null);
    api<RoomInfo>('GET', path)
      .then((r) => !cancelled && setInfo(r))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.detail.message : '방을 불러오지 못했어요.'));
    return () => {
      cancelled = true;
    };
  }, [path]);
  return { info, setInfo, error };
}

function MyRoomScreen() {
  const { info, setInfo, error } = useRoomInfo('/api/rooms/me');
  return info ? (
    <FriendsProvider>
      <ServerRoomScreen info={info} onInfo={setInfo} />
    </FriendsProvider>
  ) : (
    <RoomLoadState error={error} />
  );
}

function VisitRoomScreen({ id }: { id: string }) {
  const { info, setInfo, error } = useRoomInfo(`/api/rooms/${id}`);
  return info ? (
    <FriendsProvider>
      <ServerRoomScreen info={info} onInfo={setInfo} />
    </FriendsProvider>
  ) : (
    <RoomLoadState error={error} />
  );
}

function RoomLoadState({ error }: { error: string | null }) {
  if (!error) return <Loading />;
  return (
    <Layout>
      <div className="mx-auto w-full max-w-sm py-6">
        <Card className="text-center">
          <h2 className="mb-2 text-xl text-plum-700">들어갈 수 없는 방이에요</h2>
          <p className="mb-5 text-sm text-plum-500">{error} 친구의 방은 친구가 되거나 초대 링크로 들어갈 수 있어요.</p>
          <Button onClick={() => navigate('/')}>내 방으로</Button>
        </Card>
      </div>
    </Layout>
  );
}

/** A saved room: mine (theme editable, invite button) or someone else's (look around alone). */
function ServerRoomScreen({ info, onInfo }: { info: RoomInfo; onInfo: (r: RoomInfo) => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const { incomingCount } = useFriends();
  const isOwner = info.access === 'owner';
  const nickname = me?.nickname ?? DEMO_ROOM.owner;

  // The game shows the player (me) in this room: my nickname on the name tag
  // and the room's saved theme. Rebuilt only when the room or I change; theme
  // switches go through the game handle without a rebuild.
  const { id: roomId, name: roomName } = info;
  const initialTheme = info.theme;
  const initialItems = info.items;
  const room = useMemo<RoomData>(
    () => ({
      ...DEMO_ROOM,
      id: roomId,
      name: roomName,
      owner: nickname,
      theme: initialTheme,
      furniture: toPlacements(layoutFromServer(initialItems)),
    }),
    // Saved layouts after this are applied by the game itself (no rebuild).
    [roomId, roomName, nickname],
  );

  // ---- decorating
  const controls = useRef<GameControls | null>(null);
  const [editor, setEditor] = useState<LayoutEditor | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const notice = useCallback((m: string) => toast(m), [toast]);

  const startEditing = () => {
    const ed = controls.current?.startEdit((error) => toast(LAYOUT_ERROR_TEXT[error.code]));
    if (ed) setEditor(ed);
  };
  const finishEditing = useCallback((layout: readonly LayoutItem[] | null) => {
    controls.current?.endEdit(layout);
    setEditor(null);
    setConflict(false);
  }, []);
  const confirmDiscard = useCallback(
    () => !editor?.dirty || window.confirm('저장하지 않은 변경 사항이 있어요. 꾸미기를 그만둘까요?'),
    [editor],
  );
  const cancelEditing = useCallback(() => {
    if (confirmDiscard()) finishEditing(null);
  }, [confirmDiscard, finishEditing]);

  const saveLayout = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      const saved = await api<RoomInfo>('PUT', `/api/rooms/${info.id}/items`, {
        layout_version: info.layout_version,
        items: editor.layout(),
      });
      onInfo(saved);
      finishEditing(layoutFromServer(saved.items));
      toast('방을 저장했어요! 🛋');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else toast(e instanceof ApiError ? e.detail.message : '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  const loadLatest = async () => {
    try {
      const latest = await api<RoomInfo>('GET', `/api/rooms/${info.id}`);
      onInfo(latest);
      finishEditing(layoutFromServer(latest.items));
      toast('최신 배치를 불러왔어요.');
    } catch (e) {
      toast(e instanceof ApiError ? e.detail.message : '불러오지 못했어요.');
    }
  };

  useEditorKeys(editor, notice, cancelEditing);

  // ---- realtime: other people in this room
  const infoRef = useRef(info);
  infoRef.current = info;
  const live = useRoomLive({
    roomId: info.id,
    controls,
    onLayout: (items, version) => {
      const cur = infoRef.current;
      if (version <= cur.layout_version) return; // our own save, already applied
      const next = { ...cur, items, layout_version: version };
      onInfo(next);
      controls.current?.applyLayout(layoutFromServer(next.items));
    },
    onTheme: (theme) => {
      if (theme in THEMES) onInfo({ ...infoRef.current, theme: theme as ThemeId });
    },
    onNotice: notice,
  });
  const together = live.others.length ? `${live.others.join(', ')}님과 함께 있어요.` : '';

  // Unsaved changes: ask before leaving the page (in-app links, back button, reload/close).
  useEffect(() => {
    if (!editor) return;
    setLeaveGuard(() => confirmDiscard());
    const onUnload = (e: BeforeUnloadEvent) => {
      if (editor.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [editor, confirmDiscard]);

  const editorProps = editor && {
    editor,
    theme: info.theme,
    saving,
    onSave: () => void saveLayout(),
    onCancel: cancelEditing,
    onNotice: notice,
  };

  const saveTheme = useCallback(
    async (theme: ThemeId) => {
      const prev = info;
      onInfo({ ...info, theme });
      try {
        onInfo(await api<RoomInfo>('PATCH', `/api/rooms/${info.id}`, { theme }));
      } catch (e) {
        onInfo(prev);
        toast(e instanceof ApiError ? e.detail.message : '테마를 저장하지 못했어요.');
      }
    },
    [info, onInfo, toast],
  );

  const invite = async () => {
    try {
      const { url } = await api<{ url: string }>('POST', '/api/rooms/me/invite');
      try {
        await navigator.clipboard.writeText(url);
        toast('초대 링크를 복사했어요! 친구에게 보내 주세요 💌');
      } catch {
        window.prompt('자동 복사가 안 돼요. 아래 링크를 직접 복사해 주세요.', url);
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.detail.message : '초대 링크를 만들지 못했어요.');
    }
  };

  const where = info.access === 'friend' ? '친구의 방' : info.access === 'guest' ? '초대받은 방' : '내 방';
  return (
    <>
    <RoomScreen
      room={room}
      theme={info.theme}
      title={info.name}
      subtitle={`${THEMES[info.theme].label} · ${where}${editor ? ' · 꾸미는 중' : ''}`}
      controlsRef={controls}
      onLocalMove={live.onLocalMove}
      onLocalSay={live.onLocalSay}
      editing={!!editor}
      editBar={editorProps && <EditBar {...editorProps} />}
      panels={{
        badge: incomingCount,
        my: (close) =>
          editorProps ? (
            <EditorPanel {...editorProps} />
          ) : (
            me && (
              <MyPanel
                me={me}
                room={info}
                onTheme={saveTheme}
                onInvite={() => (close?.(), void invite())}
                onDecorate={() => (close?.(), startEditing())}
                onNavigate={close}
              />
            )
          ),
        friends: (close) => <FriendsPanel onNavigate={close} />,
      }}
      banner={
          live.state === 'replaced' ? (
            <>
              다른 탭이나 기기에서 이 방에 들어가서, 여기서는 혼자 보고 있어요.{' '}
              <button type="button" onClick={live.rejoin} className="pointer-events-auto text-blush-500 underline underline-offset-2">
                여기서 함께하기
              </button>
            </>
          ) : live.state === 'denied' ? (
            '이 방에 함께 들어갈 수 없어요. 친구가 되거나 초대 링크로 들어와 주세요.'
          ) : live.status === 'unauthorized' ? (
            '로그인이 끝나서 실시간 연결이 끊겼어요. 다시 로그인해 주세요.'
          ) : live.status !== 'open' ? (
            '실시간 연결 중이에요. 잠시 다른 사람이 보이지 않을 수 있어요.'
          ) : isOwner ? (
            together || undefined
          ) : (
            <>
              <b className="font-normal text-blush-500">{info.owner_nickname}</b>님의 방에 놀러 왔어요. {together}
            </>
          )
        }
    />
    {conflict && (
      <Modal title="방 배치가 먼저 바뀌었어요" onClose={() => setConflict(false)}>
        <p className="mb-4 text-sm leading-relaxed text-plum-700">
          다른 창이나 기기에서 이 방의 가구 배치를 먼저 저장했어요. 지금 꾸민 내용은 아직 저장되지 않았어요.
          <br />
          최신 배치를 불러온 뒤 다시 꾸며 주세요.
        </p>
        <div className="flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setConflict(false)}>
            계속 보기
          </Button>
          <Button className="flex-1" onClick={() => void loadLatest()}>
            최신 배치 불러오기
          </Button>
        </div>
      </Modal>
    )}
    </>
  );
}

/** Server items -> editor layout (unknown types from a newer catalog are skipped). */
function layoutFromServer(items: RoomInfo['items']): LayoutItem[] {
  return items.flatMap((i) => (isFurnitureType(i.type) ? [{ type: i.type, x: i.x, y: i.y, facing: (i.facing === 1 ? 1 : 0) as Facing }] : []));
}

function RoomScreen({
  room,
  theme,
  onTheme,
  title,
  subtitle,
  banner,
  panels,
  controlsRef,
  editing = false,
  editBar,
  onLocalMove,
  onLocalSay,
}: {
  room: RoomData;
  theme: ThemeId;
  /** Omitted when the viewer can't change this room's theme. */
  onTheme?: (t: ThemeId) => void;
  title?: string;
  subtitle: string;
  banner?: ReactNode;
  controlsRef?: { current: GameControls | null };
  onLocalMove?: (state: MoveState) => void;
  onLocalSay?: (text: string) => void;
  editing?: boolean;
  /** Decorating tools shown under the game on tablet/mobile. */
  editBar?: ReactNode;
  /** Logged-in rooms: side panels / rail / tabs around the game (see RoomLayout). */
  panels?: {
    badge: number;
    my: (close?: () => void) => ReactNode;
    friends: (close?: () => void) => ReactNode;
  };
}) {
  const [timeMode, setTimeMode] = useState<TimeMode>('auto');
  const [period, setPeriod] = useState<Period | null>(null);

  const nav = onTheme && (
    <nav aria-label="방 테마" className="flex gap-1 rounded-full bg-white/70 p-1 shadow-sm ring-1 ring-blush-200">
      {THEME_IDS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onTheme(id)}
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
  );

  const stage = (
    <section
      className="relative min-h-[320px] flex-1 overflow-hidden rounded-[28px] shadow-[0_8px_30px_-12px_rgba(122,74,104,0.35)] ring-4 ring-white transition-colors duration-500"
      style={{ backgroundColor: hex(THEMES[theme].backdrop) }}
    >
      <GameView
        room={room}
        theme={theme}
        timeMode={timeMode}
        onPeriodChange={setPeriod}
        controlsRef={controlsRef}
        editing={editing}
        onLocalMove={onLocalMove}
        onLocalSay={onLocalSay}
      />

      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-2xl bg-white/85 px-3 py-2 shadow-sm ring-1 ring-blush-200 backdrop-blur">
        <span aria-hidden>{THEME_EMOJI[theme]}</span>
        <div className="leading-tight">
          <p className="text-sm tracking-wide text-plum-700">{title ?? room.name}</p>
          <p className="text-[11px] text-plum-500">{subtitle}</p>
        </div>
        {period && (
          <span data-testid="period-badge" className="ml-1 rounded-full bg-lavender-100 px-2 py-0.5 text-[11px] text-plum-700">
            <span aria-hidden className="mr-0.5">{PERIOD_EMOJI[period]}</span>
            {PERIOD_LABEL[period]}
          </span>
        )}
      </div>

      {banner && (
        <p className="pointer-events-none absolute inset-x-4 top-20 mx-auto max-w-md rounded-2xl bg-white/90 px-4 py-2 text-center text-xs leading-relaxed text-plum-700 shadow-sm ring-1 ring-blush-200 sm:top-auto sm:bottom-16 sm:text-sm">
          {banner}
        </p>
      )}

      {showDevTools && <TimeDevPanel mode={timeMode} onChange={setTimeMode} />}

      {!webgl && (
        <p className="absolute bottom-4 left-4 rounded-xl bg-white/90 px-3 py-1.5 text-xs text-plum-500 ring-1 ring-blush-200">
          WebGL을 쓸 수 없어 Canvas 모드로 실행 중이에요.
        </p>
      )}
    </section>
  );

  const footer = (
    <footer className="flex flex-wrap items-center justify-center gap-2 text-xs text-plum-500 sm:text-sm">
      <Hint keys={['클릭']} label="그 자리로 이동" />
      <Hint keys={['↑', '↓', '←', '→']} label="또는" />
      <Hint keys={['W', 'A', 'S', 'D']} label="로 걷기" />
      <Hint keys={['Enter']} label="채팅" />
    </footer>
  );

  if (panels) {
    // Theme buttons live in the left panel here, not in the header.
    return (
      <Layout>
        <RoomLayout my={panels.my} friends={panels.friends} badge={panels.badge} footer={footer} editBar={editBar} editing={editing}>
          {stage}
        </RoomLayout>
      </Layout>
    );
  }
  return (
    <Layout nav={nav}>
      {stage}
      {footer}
    </Layout>
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
