import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, type Friend, type FriendRequestItem, type SearchResult } from '../api/client';
import { navigate } from '../app/router';
import { joinedLabel } from '../app/rules';
import { Button, Modal, useToast } from './ui';

type Tab = 'friends' | 'requests' | 'search';

/** Friend list, requests, and nickname search in one modal. */
export function FriendsPanel({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('friends');
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [requests, setRequests] = useState<{ incoming: FriendRequestItem[]; outgoing: FriendRequestItem[] } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([
        api<Friend[]>('GET', '/api/friends'),
        api<{ incoming: FriendRequestItem[]; outgoing: FriendRequestItem[] }>('GET', '/api/friends/requests'),
      ]);
      setFriends(f);
      setRequests(r);
    } catch (e) {
      toast(e instanceof ApiError ? e.detail.message : '친구 정보를 불러오지 못했어요.');
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const runSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    try {
      setResults(await api<SearchResult[]>('GET', `/api/friends/search?q=${encodeURIComponent(q)}&limit=20`));
    } catch (err) {
      toast(err instanceof ApiError ? err.detail.message : '검색하지 못했어요.');
    }
  };

  /** Runs an action, then refreshes lists (and search results if shown). */
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      toast(done);
    } catch (e) {
      toast(e instanceof ApiError ? e.detail.message : '처리하지 못했어요.');
    }
    await load();
    if (results) await runSearch();
    setBusy(null);
  };

  const incomingCount = requests?.incoming.length ?? 0;

  return (
    <Modal title="친구" onClose={onClose}>
      <div role="tablist" className="mb-3 flex gap-1 rounded-full bg-white/70 p-1 ring-1 ring-blush-200">
        {(
          [
            ['friends', `친구 ${friends ? friends.length : ''}`],
            ['requests', `요청${incomingCount ? ` · ${incomingCount}` : ''}`],
            ['search', '친구 찾기'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-full px-2 py-1.5 text-sm ${tab === id ? 'bg-blush-400 text-white shadow' : 'text-plum-500 hover:bg-blush-100'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'friends' && (
        <ul className="space-y-2">
          {friends?.length === 0 && <Empty>아직 친구가 없어요. ‘친구 찾기’에서 닉네임으로 찾아보세요.</Empty>}
          {friends?.map((f) => (
            <Row key={f.id} nickname={f.nickname} sub={joinedLabel(f.joined_at)}>
              {f.room_id && (
                <Button className="px-3 py-1" onClick={() => (onClose(), navigate(`/room/${f.room_id}`))}>
                  놀러 가기
                </Button>
              )}
              <Button
                variant="ghost"
                className="px-2 py-1 text-xs"
                disabled={busy === f.id}
                onClick={() => window.confirm(`${f.nickname}님을 친구에서 삭제할까요?`) && act(f.id, () => api('DELETE', `/api/friends/${f.id}`), '친구를 삭제했어요.')}
              >
                삭제
              </Button>
            </Row>
          ))}
        </ul>
      )}

      {tab === 'requests' && (
        <div className="space-y-4">
          <section>
            <h3 className="mb-2 text-sm text-plum-500">받은 요청</h3>
            <ul className="space-y-2">
              {requests?.incoming.length === 0 && <Empty>받은 친구 요청이 없어요.</Empty>}
              {requests?.incoming.map((r) => (
                <Row key={r.id} nickname={r.user.nickname} sub={joinedLabel(r.user.joined_at)}>
                  <Button className="px-3 py-1" disabled={busy === r.id} onClick={() => act(r.id, () => api('POST', `/api/friends/requests/${r.id}/accept`), '친구가 되었어요!')}>
                    수락
                  </Button>
                  <Button variant="soft" className="px-3 py-1" disabled={busy === r.id} onClick={() => act(r.id, () => api('POST', `/api/friends/requests/${r.id}/decline`), '요청을 거절했어요.')}>
                    거절
                  </Button>
                </Row>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-2 text-sm text-plum-500">보낸 요청</h3>
            <ul className="space-y-2">
              {requests?.outgoing.length === 0 && <Empty>보낸 친구 요청이 없어요.</Empty>}
              {requests?.outgoing.map((r) => (
                <Row key={r.id} nickname={r.user.nickname} sub="수락을 기다리는 중">
                  <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy === r.id} onClick={() => act(r.id, () => api('DELETE', `/api/friends/requests/${r.id}`), '요청을 취소했어요.')}>
                    취소
                  </Button>
                </Row>
              ))}
            </ul>
          </section>
        </div>
      )}

      {tab === 'search' && (
        <div>
          <form onSubmit={runSearch} className="mb-3 flex gap-2">
            <input
              aria-label="닉네임 검색"
              value={query}
              maxLength={12}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="닉네임으로 찾기"
              className="min-w-0 flex-1 rounded-full bg-white px-4 py-2 text-base text-plum-900 outline-none ring-1 ring-blush-200 focus:ring-2 focus:ring-lavender-500"
            />
            <Button type="submit" disabled={!query.trim()}>
              찾기
            </Button>
          </form>
          <ul className="space-y-2">
            {results?.length === 0 && <Empty>‘{query.trim()}’ 닉네임을 찾지 못했어요.</Empty>}
            {results?.map((u) => (
              <Row key={u.id} nickname={u.nickname} sub={joinedLabel(u.joined_at)}>
                {u.relation === 'friend' && <span className="text-xs text-plum-500">친구</span>}
                {u.relation === 'outgoing' && <span className="text-xs text-plum-500">요청 보냄</span>}
                {u.relation === 'incoming' && u.request_id && (
                  <Button className="px-3 py-1" disabled={busy === u.id} onClick={() => act(u.id, () => api('POST', `/api/friends/requests/${u.request_id}/accept`), '친구가 되었어요!')}>
                    요청 수락
                  </Button>
                )}
                {u.relation === 'none' && (
                  <Button className="px-3 py-1" disabled={busy === u.id} onClick={() => act(u.id, () => api('POST', '/api/friends/requests', { user_id: u.id }), '친구 요청을 보냈어요.')}>
                    친구 요청
                  </Button>
                )}
              </Row>
            ))}
          </ul>
          <p className="mt-3 text-xs text-plum-500/80">같은 닉네임이 여럿이면 가입 시기로 구분해 보세요.</p>
        </div>
      )}
    </Modal>
  );
}

function Row({ nickname, sub, children }: { nickname: string; sub: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 ring-1 ring-blush-100">
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lavender-100 text-sm text-plum-700">
        {Array.from(nickname)[0]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-plum-700">{nickname}</span>
        <span className="block text-xs text-plum-500">{sub}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">{children}</span>
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <li className="rounded-2xl bg-white/60 px-3 py-4 text-center text-sm text-plum-500">{children}</li>;
}
