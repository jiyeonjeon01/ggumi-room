import { useEffect, useState } from 'react';
import { api, type Me, type PartyInfo, type RoomInfo } from '../api/client';
import { navigate } from '../app/router';
import { joinedLabel } from '../app/rules';
import { THEME_IDS, THEMES, type ThemeId } from '../game/art/themes';
import { Button } from './ui';

const THEME_EMOJI: Record<ThemeId, string> = { pastel: '🎀', galaxy: '🪐', plant: '🌿' };
const WHERE: Record<RoomInfo['access'], string> = { owner: '내 방', friend: '친구의 방', guest: '초대받은 방', member: '파티룸' };

/**
 * Left panel: who I am and what I can do here. In my room: theme and invite.
 * In someone else's room: whose room it is and the way home (no decorating).
 */
export function MyPanel({
  me,
  room,
  onTheme,
  onInvite,
  onDecorate,
  onGuestbook,
  onParty,
  onNavigate,
}: {
  me: Me;
  room: RoomInfo;
  onTheme: (t: ThemeId) => void;
  onInvite: () => void;
  /** Starts decorating (furniture). */
  onDecorate: () => void;
  onGuestbook: () => void;
  /** Opens a party room, or goes to the one I already have open. */
  onParty: () => void;
  /** Lets a drawer/sheet close itself when leaving the room. */
  onNavigate?: () => void;
}) {
  const isOwner = room.access === 'owner';
  const hasParty = useMyParty() !== null;
  const party = (
    <Button variant="soft" className="w-full" onClick={onParty}>
      {hasParty ? '🎉 내 파티룸으로' : '🎉 파티룸 만들기'}
    </Button>
  );
  return (
    <div className="space-y-4">
      <section aria-label="내 프로필" className="flex items-center gap-3">
        <Avatar name={me.nickname} />
        <div className="min-w-0">
          <p className="truncate text-lg text-plum-700">{me.nickname}</p>
          <p className="text-xs text-plum-500">{joinedLabel(me.created_at)}</p>
        </div>
      </section>

      <section aria-label="지금 있는 방" className="rounded-2xl bg-white px-3 py-2.5 ring-1 ring-blush-100">
        <p className="text-[11px] text-plum-500">지금 있는 방</p>
        <p className="truncate text-plum-700">{room.name}</p>
        <p className="text-xs text-plum-500">
          {THEMES[room.theme].label} · {WHERE[room.access]}
        </p>
      </section>

      {isOwner ? (
        <>
          <section aria-label="방 테마">
            <p className="mb-1.5 text-sm text-plum-500">테마</p>
            <div className="flex flex-col gap-1 rounded-2xl bg-white/70 p-1 ring-1 ring-blush-200">
              {THEME_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onTheme(id)}
                  aria-pressed={room.theme === id}
                  className={`rounded-xl px-3 py-1.5 text-left text-sm transition-colors pointer-coarse:py-2.5 ${
                    room.theme === id ? 'bg-blush-400 text-white shadow' : 'text-plum-500 hover:bg-blush-100'
                  }`}
                >
                  <span aria-hidden className="mr-1.5">{THEME_EMOJI[id]}</span>
                  {THEMES[id].label}
                </button>
              ))}
            </div>
          </section>
          <Button variant="soft" className="w-full" onClick={onDecorate}>
            🛋 방 꾸미기
          </Button>
          <Button variant="soft" className="w-full" onClick={onGuestbook}>
            📒 방명록
          </Button>
          <Button className="w-full" onClick={onInvite}>
            💌 친구 초대하기
          </Button>
          {party}
        </>
      ) : (
        <>
          <section aria-label="방 주인" className="flex items-center gap-3 rounded-2xl bg-lavender-100/70 px-3 py-2.5">
            <Avatar name={room.owner_nickname} small />
            <div className="min-w-0">
              <p className="text-[11px] text-plum-500">방 주인</p>
              <p className="truncate text-plum-700">{room.owner_nickname}</p>
            </div>
          </section>
          <Button variant="soft" className="w-full" onClick={onGuestbook}>
            📒 방명록 남기기
          </Button>
          {party}
          <Button className="w-full" onClick={() => (onNavigate?.(), navigate('/'))}>
            🏠 내 방으로 돌아가기
          </Button>
        </>
      )}
    </div>
  );
}

/** The party I host that's still open (null: none, or not known yet). */
function useMyParty(): PartyInfo | null {
  const [party, setParty] = useState<PartyInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<PartyInfo | null>('GET', '/api/parties/mine')
      .then((p) => !cancelled && setParty(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return party;
}

export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-lavender-100 text-plum-700 ring-2 ring-white ${small ? 'h-9 w-9 text-sm' : 'h-12 w-12 text-xl'}`}
    >
      {Array.from(name)[0]}
    </span>
  );
}
