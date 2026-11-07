import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../app/auth';
import { navigate } from '../app/router';
import { Button, Modal, useToast } from './ui';

type Reason = 'abuse' | 'spam' | 'sexual' | 'privacy' | 'other';
export type ReportContext = 'chat' | 'request' | 'room' | 'party' | 'guestbook' | 'other';

const REASONS: [Reason, string][] = [
  ['abuse', '욕설·괴롭힘'],
  ['spam', '도배·광고'],
  ['sexual', '성적인 내용'],
  ['privacy', '개인정보 노출·요구'],
  ['other', '그 밖의 문제'],
];

/**
 * Report someone and/or block them. Reports go to the operator; blocking ends the
 * friendship and keeps them out of my room, search and friend requests (they aren't told).
 */
export function SafetyModal({
  user,
  context,
  onClose,
  onBlocked,
}: {
  user: { id: string; nickname: string };
  context: ReportContext;
  onClose: () => void;
  /** After blocking (e.g. close the chat with them). */
  onBlocked?: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState<Reason | null>(null);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);

  const report = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return;
    setBusy(true);
    try {
      await api('POST', '/api/reports', { user_id: user.id, reason, context, detail: detail.trim() });
      toast('신고를 접수했어요. 운영자가 확인할게요.');
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail.message : '신고하지 못했어요.');
      setBusy(false);
    }
  };

  const block = async () => {
    if (!window.confirm(`${user.nickname}님을 차단할까요?\n친구가 끊기고, 서로 친구 요청·채팅·방 방문을 할 수 없어요. 상대에게 알림은 가지 않아요.`)) return;
    setBusy(true);
    try {
      await api('POST', '/api/blocks', { user_id: user.id });
      toast(`${user.nickname}님을 차단했어요. 계정 관리에서 풀 수 있어요.`);
      onBlocked?.();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail.message : '차단하지 못했어요.');
      setBusy(false);
    }
  };

  return (
    <Modal title={`${user.nickname}님 신고·차단`} onClose={onClose}>
      <form onSubmit={report} className="space-y-3">
        <fieldset>
          <legend className="mb-2 text-sm text-plum-700">어떤 문제가 있었나요?</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {REASONS.map(([id, label]) => (
              <label
                key={id}
                className={`flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm ring-1 pointer-coarse:min-h-10 ${
                  reason === id ? 'bg-blush-100 text-plum-700 ring-blush-400' : 'bg-white text-plum-500 ring-blush-200'
                }`}
              >
                <input type="radio" name="reason" value={id} checked={reason === id} onChange={() => setReason(id)} className="accent-blush-500" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <textarea
          aria-label="자세한 내용 (선택)"
          value={detail}
          maxLength={300}
          rows={3}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="언제, 어떤 일이 있었는지 적어 주면 확인에 도움이 돼요 (선택, 300자)"
          className="w-full resize-none rounded-2xl bg-white px-3 py-2 text-sm text-plum-900 outline-none ring-1 ring-blush-200 focus:ring-2 focus:ring-lavender-500 pointer-coarse:text-base"
        />
        <Button type="submit" className="w-full" disabled={!reason || busy}>
          🚩 신고하기
        </Button>
      </form>
      <div className="mt-4 border-t border-blush-100 pt-3">
        <p className="mb-2 text-xs leading-relaxed text-plum-500">차단하면 친구가 끊기고, 서로 찾거나 친구 요청·채팅·방 방문을 할 수 없어요. 링크로 여는 파티룸에서는 함께 있을 수 있어요.</p>
        <Button variant="soft" className="w-full" onClick={() => void block()} disabled={busy}>
          🚫 {user.nickname}님 차단하기
        </Button>
      </div>
    </Modal>
  );
}

interface Blocked {
  user_id: string;
  nickname: string;
  blocked_at: string;
}

/** My account: people I blocked, the privacy policy, and deleting the account. */
export function AccountModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { logout } = useAuth();
  const [blocked, setBlocked] = useState<Blocked[] | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [password, setPassword] = useState('');
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Blocked[]>('GET', '/api/blocks')
      .then(setBlocked)
      .catch(() => setBlocked([]));
  }, []);

  const unblock = async (b: Blocked) => {
    try {
      await api('DELETE', `/api/blocks/${b.user_id}`);
      setBlocked((list) => list?.filter((x) => x.user_id !== b.user_id) ?? null);
      toast(`${b.nickname}님 차단을 풀었어요.`);
    } catch (err) {
      toast(err instanceof ApiError ? err.detail.message : '차단을 풀지 못했어요.');
    }
  };

  const withdraw = async (e: FormEvent) => {
    e.preventDefault();
    if (!sure || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/auth/withdraw', { password });
      await logout().catch(() => {});
      onClose();
      navigate('/', { replace: true });
      toast('탈퇴했어요. 그동안 꾸미룸과 함께해 줘서 고마워요.');
    } catch (err) {
      setError(err instanceof ApiError ? err.detail.message : '탈퇴하지 못했어요.');
      setBusy(false);
    }
  };

  return (
    <Modal title="⚙️ 계정 관리" onClose={onClose}>
      <section aria-label="차단한 사람" className="mb-4">
        <h3 className="mb-2 text-sm text-plum-700">차단한 사람</h3>
        {blocked === null ? (
          <p className="text-sm text-plum-500">불러오는 중…</p>
        ) : blocked.length === 0 ? (
          <p className="rounded-2xl bg-white/60 px-3 py-2 text-sm text-plum-500">차단한 사람이 없어요.</p>
        ) : (
          <ul className="space-y-1.5">
            {blocked.map((b) => (
              <li key={b.user_id} className="flex items-center gap-2 rounded-2xl bg-white px-3 py-1.5 ring-1 ring-blush-100">
                <span className="min-w-0 flex-1 truncate text-sm text-plum-700">{b.nickname}</span>
                <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => void unblock(b)}>
                  차단 풀기
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mb-4 text-sm">
        <a href="/privacy" target="_blank" rel="noopener" className="text-blush-500 underline underline-offset-2">
          개인정보처리방침
        </a>
      </p>

      <section aria-label="회원 탈퇴" className="border-t border-blush-100 pt-3">
        {!leaving ? (
          <Button variant="ghost" className="w-full text-sm" onClick={() => setLeaving(true)}>
            회원 탈퇴
          </Button>
        ) : (
          <form onSubmit={withdraw} className="space-y-2">
            <h3 className="text-sm text-plum-700">회원 탈퇴</h3>
            <p className="text-xs leading-relaxed text-plum-500">
              탈퇴하면 내 방과 가구, 친구, 1:1 채팅(상대 쪽 기록 포함), 내가 쓴 방명록, 내가 연 파티룸이 <b className="font-normal text-blush-500">바로 지워지고 되돌릴 수 없어요</b>.
            </p>
            <input
              type="password"
              aria-label="비밀번호 확인"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 한 번 더 적어 주세요"
              className="w-full rounded-full bg-white px-4 py-2 text-base text-plum-900 outline-none ring-1 ring-blush-200 focus:ring-2 focus:ring-lavender-500"
            />
            <label className="flex items-start gap-2 text-xs text-plum-700 pointer-coarse:min-h-10">
              <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 accent-blush-500" />
              모든 기록이 지워지는 것을 이해했어요.
            </label>
            {error && <p role="alert" className="text-sm text-blush-500">{error}</p>}
            <div className="flex gap-2">
              <Button variant="soft" className="flex-1" onClick={() => setLeaving(false)} disabled={busy}>
                그만두기
              </Button>
              <Button type="submit" className="flex-1" disabled={!sure || !password || busy}>
                {busy ? '지우는 중…' : '탈퇴하기'}
              </Button>
            </div>
          </form>
        )}
      </section>
    </Modal>
  );
}
