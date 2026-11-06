import type { Me, RoomInfo } from '../api/client';
import type { HeadCount } from '../app/roomLive';
import { navigate } from '../app/router';
import { joinedLabel } from '../app/rules';
import { Avatar } from './MyPanel';
import { Button } from './ui';

/**
 * Left panel in a party room: who I am, the party and its head count, the
 * link to share, and the way home. The host can also end the party. No theme,
 * decorating or guestbook here: a party lounge has a fixed setup.
 */
export function PartyPanel({
  me,
  room,
  count,
  onCopyLink,
  onEnd,
  onNavigate,
}: {
  me: Me;
  room: RoomInfo;
  count: HeadCount;
  onCopyLink: () => void;
  /** Host only: asks to end the party for everyone. */
  onEnd?: () => void;
  /** Lets a drawer/sheet close itself when leaving the room. */
  onNavigate?: () => void;
}) {
  const isHost = room.access === 'owner';
  const filled = Math.min(count.count, count.capacity);
  return (
    <div className="space-y-4">
      <section aria-label="내 프로필" className="flex items-center gap-3">
        <Avatar name={me.nickname} />
        <div className="min-w-0">
          <p className="truncate text-lg text-plum-700">{me.nickname}</p>
          <p className="text-xs text-plum-500">{joinedLabel(me.created_at)}</p>
        </div>
      </section>

      <section aria-label="지금 있는 파티룸" className="rounded-2xl bg-white px-3 py-2.5 ring-1 ring-blush-100">
        <p className="text-[11px] text-plum-500">지금 있는 파티룸</p>
        <p className="truncate text-plum-700">{room.name}</p>
        <p className="text-xs text-plum-500">
          방장 {isHost ? '나' : room.owner_nickname} · 임시 파티룸
        </p>
        <div className="mt-2" aria-label={`지금 ${count.count}명, 최대 ${count.capacity}명`}>
          <div className="mb-1 flex items-center justify-between text-xs text-plum-500">
            <span>함께 있는 사람</span>
            <span className="text-plum-700">
              {count.count}/{count.capacity}명
            </span>
          </div>
          <div className="flex gap-0.5" aria-hidden>
            {Array.from({ length: count.capacity }, (_, i) => (
              <span key={i} className={`h-2 flex-1 rounded-sm ${i < filled ? 'bg-blush-400' : 'bg-blush-100'}`} />
            ))}
          </div>
        </div>
      </section>

      <Button className="w-full" onClick={onCopyLink}>
        🔗 파티룸 링크 복사
      </Button>
      <p className="-mt-2 text-xs leading-relaxed text-plum-500">
        링크가 있으면 친구가 아니어도 들어올 수 있어요. 모두 나가고 30분이 지나면 파티룸이 저절로 닫혀요.
      </p>
      {isHost && onEnd && (
        <Button variant="soft" className="w-full" onClick={onEnd}>
          🎈 파티룸 끝내기
        </Button>
      )}
      <Button variant="soft" className="w-full" onClick={() => (onNavigate?.(), navigate('/'))}>
        🏠 내 방으로 돌아가기
      </Button>
    </div>
  );
}
