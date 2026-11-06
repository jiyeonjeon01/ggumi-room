import { useEffect, useState } from 'react';
import { api, ApiError, type InvitePreview } from '../api/client';
import { useAuth } from '../app/auth';
import { inviteArrival, type InviteArrival } from '../app/inviteArrival';
import { navigate, pendingInvite } from '../app/router';
import { Button, Card } from '../components/ui';

/**
 * Landing page for /invite/{token}. Visitors first see a cute invitation card
 * (no forced redirect to login). The inviter's nickname comes from the API and
 * is rendered as plain text by React (no HTML injection), capped at 12 chars by
 * the sign-up rules.
 */
export function InvitePage({ token }: { token: string }) {
  const { state } = useAuth();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPreview({ status: 'not_found', inviter_nickname: null, room_name: null, expires_at: null });
      return;
    }
    api<InvitePreview>('GET', `/api/invites/${token}`)
      .then((p) => {
        setPreview(p);
        if (p.status === 'valid') pendingInvite.set(token);
        else pendingInvite.clear();
      })
      .catch((e) => setError(e instanceof ApiError ? e.detail.message : '초대장을 불러오지 못했어요.'));
  }, [token]);

  const next = `/invite/${token}`;
  const go = (to: 'signup' | 'login') => navigate(`/${to}?next=${encodeURIComponent(next)}`);
  const enter = async () => {
    setJoining(true);
    try {
      const arrival = await api<InviteArrival>('POST', `/api/invites/${token}/accept`);
      pendingInvite.clear();
      inviteArrival.set(arrival);
      navigate(`/room/${arrival.room_id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.detail.message : '방에 들어가지 못했어요.');
      setJoining(false);
    }
  };

  const valid = preview?.status === 'valid';
  const inviter = preview?.inviter_nickname ?? '';

  return (
    <div className="mx-auto w-full max-w-md py-6">
      <Card className="relative overflow-hidden text-center">
        <Envelope dim={!valid && preview !== null} />
        {preview === null && !error && <p className="py-6 text-plum-500">초대장을 여는 중…</p>}
        {error && <p className="py-4 text-blush-500">{error}</p>}

        {valid && (
          <>
            <h2 className="mb-2 text-2xl leading-snug text-plum-700">
              <span className="text-blush-500">{inviter}</span>님의 작은 방에
              <br />
              초대받았어요!
            </h2>
            <p className="mb-6 text-plum-500">같이 놀 준비됐나요? 가입하고 놀러 와요.</p>
            {state.status === 'user' ? (
              <div className="space-y-2">
                <Button className="w-full" onClick={enter} disabled={joining}>
                  {joining ? '들어가는 중…' : `${inviter}님의 방으로 놀러 가기`}
                </Button>
                <p className="text-xs text-plum-500">{state.me.nickname}님으로 들어가요.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Button className="w-full" onClick={() => go('signup')} disabled={state.status === 'loading'}>
                  꾸미룸 시작하기
                </Button>
                <Button variant="soft" className="w-full" onClick={() => go('login')} disabled={state.status === 'loading'}>
                  이미 회원이라면 로그인
                </Button>
              </div>
            )}
            <p className="mt-4 text-xs text-plum-500/80">초대 링크로 들어가도 자동으로 친구가 되지는 않아요.</p>
          </>
        )}

        {preview && !valid && (
          <>
            <h2 className="mb-2 text-xl text-plum-700">
              {preview.status === 'not_found' ? '초대장을 찾을 수 없어요' : '이 초대장은 더 이상 쓸 수 없어요'}
            </h2>
            <p className="mb-6 text-sm text-plum-500">
              {preview.status === 'expired'
                ? '초대 링크의 유효기간(7일)이 지났어요. 친구에게 새 링크를 부탁해 보세요.'
                : preview.status === 'revoked'
                  ? '방 주인이 링크를 새로 만들었거나 거둬들였어요. 친구에게 새 링크를 부탁해 보세요.'
                  : '주소가 잘못되었을 수 있어요. 받은 링크를 다시 확인해 주세요.'}
            </p>
            <Button variant="soft" onClick={() => navigate('/')}>
              꾸미룸 구경하기
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

/** Pixel envelope with a heart seal, drawn as crisp SVG rects. */
function Envelope({ dim }: { dim: boolean }) {
  return (
    <svg viewBox="0 0 32 22" className={`mx-auto mb-4 h-20 w-28 ${dim ? 'opacity-50 grayscale' : ''}`} shapeRendering="crispEdges" aria-hidden>
      <rect x="1" y="3" width="30" height="18" fill="#7a4a68" />
      <rect x="2" y="4" width="28" height="16" fill="#fff6f9" />
      <path fill="#f9cfe0" d="M2 4h28v1h-1v1h-2v1h-2v1h-2v1h-2v1h-2v1h-2v1h-2v-1h-2v-1H9V9H7V8H5V7H3V6H2z" />
      <path fill="#e9a8c4" d="M2 20h28v-1h-2v-1h-2v-1h-2v-1h-2v-1H10v1H8v1H6v1H4v1H2z" />
      <rect x="14" y="9" width="2" height="1" fill="#ff7fae" />
      <rect x="17" y="9" width="2" height="1" fill="#ff7fae" />
      <rect x="13" y="10" width="7" height="2" fill="#ff7fae" />
      <rect x="14" y="12" width="5" height="1" fill="#ff7fae" />
      <rect x="15" y="13" width="3" height="1" fill="#ff7fae" />
      <rect x="16" y="14" width="1" height="1" fill="#ff7fae" />
      <rect x="14" y="10" width="1" height="1" fill="#fff1f6" />
    </svg>
  );
}
