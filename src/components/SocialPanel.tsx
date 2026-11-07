import { useId, type ReactNode } from 'react';
import type { ActiveParty } from '../api/client';
import { useFriends } from '../app/friends';
import { useStoredFlag } from '../app/layout';
import { useLive } from '../app/live';
import { formatRemaining, remainingMs, useActiveParties, useTick } from '../app/parties';
import { navigate, useRoute } from '../app/router';
import { FriendsPanel } from './FriendsPanel';
import { Button } from './ui';

/**
 * Right panel: friends on top, party rooms below, each folding on its own
 * (remembered per browser). `onNavigate` lets a sheet close itself when the
 * user leaves for another room.
 */
export function SocialPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { friends } = useFriends();
  const { presence } = useLive();
  const route = useRoute();
  const here = route.name === 'room' ? route.id : '';
  const { parties, offset } = useActiveParties(here);
  const [friendsOpen, setFriendsOpen] = useStoredFlag('ggumi:ui:friends-open', true);
  const [partiesOpen, setPartiesOpen] = useStoredFlag('ggumi:ui:parties-open', true);
  // Only green (online) friends; away and offline don't count.
  const online = friends?.filter((f) => presence[f.id] === 'online').length ?? 0;

  return (
    <div className="space-y-3">
      <Section title="친구" count={friends ? `온라인 ${online}` : ''} open={friendsOpen} onToggle={() => setFriendsOpen(!friendsOpen)}>
        <FriendsPanel onNavigate={onNavigate} />
      </Section>
      <Section title="파티룸" count={parties ? String(parties.length) : ''} open={partiesOpen} onToggle={() => setPartiesOpen(!partiesOpen)}>
        <PartyList parties={parties} offset={offset} here={here} onNavigate={onNavigate} />
      </Section>
    </div>
  );
}

function Section({ title, count, open, onToggle, children }: { title: string; count: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-label={title}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="flex w-full items-center justify-between rounded-xl px-1.5 py-1 text-left text-plum-700 hover:bg-blush-100 pointer-coarse:min-h-10"
        >
          <span>
            {title}
            {count && <span className="text-sm text-plum-500"> ({count})</span>}
          </span>
          <span aria-hidden className={`text-xs text-plum-500 transition-transform ${open ? '' : '-rotate-90'}`}>
            ▼
          </span>
        </button>
      </h3>
      <div id={id} hidden={!open} className="mt-2">
        {open && children}
      </div>
    </section>
  );
}

function PartyList({ parties, offset, here, onNavigate }: { parties: ActiveParty[] | null; offset: number; here: string; onNavigate?: () => void }) {
  const now = useTick(!!parties?.some((p) => p.closes_at));
  if (!parties) return <p className="px-1 text-sm text-plum-500">파티룸을 찾는 중…</p>;
  return (
    <>
      <ul className="space-y-2">
        {parties.length === 0 && (
          <li className="rounded-2xl bg-white/60 px-3 py-3 text-center text-sm text-plum-500">
            참가 중인 파티룸이 없어요. 내 정보에서 파티룸을 열거나 받은 링크로 들어가 보세요.
          </li>
        )}
        {parties.map((p) => {
          const current = p.room_id === here;
          const left = p.closes_at && !current ? remainingMs(p.closes_at, offset, now) : null;
          return (
            <li key={p.room_id} data-party={p.room_id} className="rounded-2xl bg-white px-3 py-2 ring-1 ring-blush-100">
              <div className="flex items-center gap-1.5">
                <span aria-hidden>🎈</span>
                <span className="min-w-0 flex-1 truncate text-sm text-plum-700" title={p.name}>
                  {p.name}
                </span>
                {p.is_host && <span className="shrink-0 rounded-full bg-blush-100 px-1.5 text-[11px] leading-5 text-blush-500">방장</span>}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <p className="min-w-0 flex-1 text-xs leading-snug text-plum-500">
                  <span className="text-plum-700" aria-label={`지금 ${p.count}명, 최대 ${p.capacity}명`}>
                    {p.count}/{p.capacity}명
                  </span>
                  {left !== null ? (
                    <span data-countdown>
                      {' '}
                      · {left > 0 ? `${formatRemaining(left)} 뒤 닫혀요` : '곧 닫혀요'}
                    </span>
                  ) : (
                    !p.is_host && <span> · 방장 {p.host_nickname}</span>
                  )}
                </p>
                {current ? (
                  <span className="shrink-0 whitespace-nowrap text-xs text-blush-500">지금 여기</span>
                ) : (
                  <Button className="shrink-0 whitespace-nowrap px-3 py-1 text-xs" onClick={() => (onNavigate?.(), navigate(`/room/${p.room_id}`))}>
                    {p.inside ? '입장하기' : '다시 입장하기'}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 px-1 text-xs leading-relaxed text-plum-500/80">임시 파티룸이에요. 모두 나가고 30분이 지나거나 방장이 끝내면 닫혀요.</p>
    </>
  );
}
