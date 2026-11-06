import { useEffect, useState } from 'react';
import { api, ApiError, type PartyPreview } from '../api/client';
import { useAuth } from '../app/auth';
import { navigate } from '../app/router';
import { Button, Card } from '../components/ui';

/**
 * Landing page for /party/{token}. Logged out, it only says it's a party link
 * and asks to log in: the API tells nobody but logged-in users the party's
 * name, host or head count. Logged in, it shows the party and lets anyone join,
 * friends with the host or not.
 */
export function PartyPage({ token }: { token: string }) {
  const { state } = useAuth();
  const [preview, setPreview] = useState<PartyPreview | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loggedIn = state.status === 'user';

  useEffect(() => {
    if (!loggedIn) return;
    if (!token) {
      setPreview({ status: 'not_found', room_id: null, name: null, host_nickname: null, capacity: null, count: null });
      return;
    }
    api<PartyPreview>('GET', `/api/parties/join/${token}`)
      .then(setPreview)
      .catch((e) => setError(e instanceof ApiError ? e.detail.message : '파티룸을 불러오지 못했어요.'));
  }, [token, loggedIn]);

  const next = `/party/${token}`;
  const go = (to: 'signup' | 'login') => navigate(`/${to}?next=${encodeURIComponent(next)}`);
  const enter = async () => {
    setJoining(true);
    try {
      const { room_id } = await api<{ room_id: string }>('POST', `/api/parties/join/${token}`);
      navigate(`/room/${room_id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) setPreview((p) => p && { ...p, status: 'closed' });
      else setError(e instanceof ApiError ? e.detail.message : '파티룸에 들어가지 못했어요.');
      setJoining(false);
    }
  };

  const open = preview?.status === 'open';
  const full = open && (preview.count ?? 0) >= (preview.capacity ?? 10);

  return (
    <div className="mx-auto w-full max-w-md py-6">
      <Card className="relative overflow-hidden text-center">
        <Balloons dim={preview !== null && !open} />

        {!loggedIn && (
          <>
            <h2 className="mb-2 text-2xl leading-snug text-plum-700">파티룸 초대장이 왔어요!</h2>
            <p className="mb-6 text-plum-500">로그인하면 누가 연 파티인지 보고 바로 들어갈 수 있어요.</p>
            <div className="space-y-2">
              <Button className="w-full" onClick={() => go('login')} disabled={state.status === 'loading'}>
                로그인하고 들어가기
              </Button>
              <Button variant="soft" className="w-full" onClick={() => go('signup')} disabled={state.status === 'loading'}>
                꾸미룸 시작하기
              </Button>
            </div>
          </>
        )}

        {loggedIn && preview === null && !error && <p className="py-6 text-plum-500">파티룸을 찾는 중…</p>}
        {error && <p className="py-4 text-blush-500">{error}</p>}

        {loggedIn && open && (
          <>
            <h2 className="mb-2 text-2xl leading-snug text-plum-700">
              <span className="text-blush-500">{preview.host_nickname}</span>님의 파티룸에
              <br />
              놀러 갈까요?
            </h2>
            <p className="mb-1 text-plum-500">{preview.name}</p>
            <p className="mb-6 text-sm text-plum-500">
              지금 {preview.count}/{preview.capacity}명이 놀고 있어요.
              {full && ' 꽉 찼지만, 들어가서 자리가 나면 다시 시도할 수 있어요.'}
            </p>
            <Button className="w-full" onClick={enter} disabled={joining}>
              {joining ? '들어가는 중…' : '🎉 파티룸 들어가기'}
            </Button>
            <p className="mt-2 text-xs text-plum-500">{state.me.nickname}님으로 들어가요. 친구가 아니어도 함께 놀 수 있어요.</p>
          </>
        )}

        {loggedIn && preview && !open && (
          <>
            <h2 className="mb-2 text-xl text-plum-700">{preview.status === 'closed' ? '이미 끝난 파티룸이에요' : '파티룸을 찾을 수 없어요'}</h2>
            <p className="mb-6 text-sm text-plum-500">
              {preview.status === 'closed'
                ? '방장이 파티를 끝냈거나, 모두 나간 뒤 30분이 지나 문을 닫았어요.'
                : '주소가 잘못되었을 수 있어요. 받은 링크를 다시 확인해 주세요.'}
            </p>
            <Button variant="soft" onClick={() => navigate('/')}>
              내 방으로
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

/** Three pixel balloons, drawn as crisp SVG rects like the invite envelope. */
export function Balloons({ dim = false, className = 'mx-auto mb-4 h-20 w-28' }: { dim?: boolean; className?: string }) {
  const balloon = (x: number, y: number, c: string, shine: string) => (
    <g>
      <rect x={x + 1} y={y} width="4" height="1" fill={c} />
      <rect x={x} y={y + 1} width="6" height="5" fill={c} />
      <rect x={x + 1} y={y + 6} width="4" height="1" fill={c} />
      <rect x={x + 2} y={y + 7} width="2" height="1" fill={c} />
      <rect x={x + 1} y={y + 2} width="1" height="2" fill={shine} />
      <rect x={x + 3} y={y + 8} width="1" height={8 - y} fill="#7a4a68" />
    </g>
  );
  return (
    <svg viewBox="0 0 24 18" className={`${className} ${dim ? 'opacity-50 grayscale' : ''}`} shapeRendering="crispEdges" aria-hidden>
      {balloon(1, 3, '#f7a8c8', '#fff1f6')}
      {balloon(9, 0, '#ffe38a', '#fffbe6')}
      {balloon(17, 3, '#c9a8f0', '#f3ecff')}
      <rect x="4" y="16" width="17" height="1" fill="#7a4a68" />
    </svg>
  );
}
