import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type GuestbookEntry, type GuestbookPage, type RoomInfo } from '../api/client';
import { Button, Modal, useToast } from './ui';

const MAX = 100;
/** Memo paper colors and tilts, picked per note so the board looks hand-pinned. */
const PAPER = ['bg-[#fff6d9]', 'bg-blush-50', 'bg-lavender-100', 'bg-[#e9f7ee]'];
const TILT = ['-rotate-1', 'rotate-1', 'rotate-0', '-rotate-[0.5deg]'];

function stamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A small hash so a note keeps its paper color across reloads. */
const pick = (id: string, n: number) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % n;

/**
 * The room's guestbook as a memo board. Everyone who may be in the room can
 * read and write; the author and the room owner can take a note down. The
 * owner can close the guestbook. Notes are plain text (never HTML).
 */
export function GuestbookModal({ room, onClose, onRoom }: { room: RoomInfo; onClose: () => void; onRoom: (r: RoomInfo) => void }) {
  const toast = useToast();
  const isOwner = room.access === 'owner';
  const [entries, setEntries] = useState<GuestbookEntry[] | null>(null);
  const [enabled, setEnabled] = useState(room.guestbook_enabled);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      try {
        const page = await api<GuestbookPage>('GET', `/api/rooms/${room.id}/guestbook${before ? `?before=${before}` : ''}`);
        setEnabled(page.enabled);
        setHasMore(page.has_more);
        setEntries((cur) => (before && cur ? [...cur, ...page.entries] : page.entries));
      } catch (e) {
        toast(e instanceof ApiError ? e.detail.message : '방명록을 불러오지 못했어요.');
        setEntries([]);
      }
    },
    [room.id, toast],
  );
  useEffect(() => void load(), [load]);

  const chars = Array.from(text).length;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || chars > MAX) return;
    setBusy(true);
    try {
      const entry = await api<GuestbookEntry>('POST', `/api/rooms/${room.id}/guestbook`, { body: text });
      setEntries((cur) => [entry, ...(cur ?? [])]);
      setText('');
      toast('방명록을 남겼어요! 📝');
    } catch (err) {
      toast(err instanceof ApiError ? err.detail.message : '방명록을 남기지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api('DELETE', `/api/guestbook/${id}`);
      setEntries((cur) => (cur ?? []).filter((x) => x.id !== id));
      toast('글을 지웠어요.');
    } catch (err) {
      toast(err instanceof ApiError ? err.detail.message : '지우지 못했어요.');
    }
  };

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next); // right away; put back if the server says no
    try {
      const updated = await api<RoomInfo>('PATCH', `/api/rooms/${room.id}`, { guestbook_enabled: next });
      onRoom(updated);
      setEnabled(updated.guestbook_enabled);
      if (updated.guestbook_enabled) void load();
      toast(updated.guestbook_enabled ? '방명록을 열었어요.' : '방명록을 닫았어요.');
    } catch (err) {
      setEnabled(!next);
      toast(err instanceof ApiError ? err.detail.message : '바꾸지 못했어요.');
    }
  };

  return (
    <Modal title={`📒 ${room.owner_nickname}님의 방명록`} onClose={onClose}>
      <div className="space-y-3">
        {isOwner && (
          <label className="flex items-center justify-between rounded-2xl bg-white/70 px-3 py-2 text-sm text-plum-700 ring-1 ring-blush-100">
            방명록 열어 두기
            <input type="checkbox" checked={enabled} onChange={() => void toggle()} className="h-4 w-4 accent-[#f08cb3]" />
          </label>
        )}

        {!enabled ? (
          <p className="rounded-2xl bg-white/60 px-3 py-6 text-center text-sm text-plum-500">
            {isOwner ? '방명록을 닫아 두었어요. 열면 다시 보이고 쓸 수 있어요.' : '방 주인이 방명록을 닫아 두었어요.'}
          </p>
        ) : (
          <>
            <form onSubmit={submit} className="space-y-1.5">
              <label htmlFor="guestbook-input" className="sr-only">
                방명록에 남길 말
              </label>
              <textarea
                id="guestbook-input"
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={MAX * 2}
                placeholder="따뜻한 한마디를 남겨 주세요 (100자)"
                className="w-full resize-none rounded-2xl bg-[#fffaf0] px-3 py-2 text-sm text-plum-700 ring-1 ring-blush-200 outline-none focus:ring-blush-400 pointer-coarse:text-base"
              />
              <div className="flex items-center justify-between">
                <span className={`text-xs ${chars > MAX ? 'text-blush-500' : 'text-plum-500'}`}>
                  {chars}/{MAX}
                </span>
                <Button type="submit" className="px-4 py-1.5" disabled={busy || !text.trim() || chars > MAX}>
                  {busy ? '남기는 중…' : '📌 남기기'}
                </Button>
              </div>
            </form>

            {entries === null && <p className="py-4 text-center text-sm text-plum-500">방명록을 펼치는 중…</p>}
            {entries?.length === 0 && <p className="py-4 text-center text-sm text-plum-500">아직 남긴 글이 없어요. 첫 글을 남겨 볼까요?</p>}
            <ul aria-label="방명록 글" className="grid grid-cols-1 gap-3 py-1 sm:grid-cols-2">
              {entries?.map((e) => (
                <li key={e.id} className={`relative rounded-xl px-3 pb-2 pt-3 shadow-sm ring-1 ring-black/5 ${PAPER[pick(e.id, PAPER.length)]} ${TILT[pick(e.id, TILT.length)]}`}>
                  <span aria-hidden className="absolute -top-2 left-1/2 -translate-x-1/2 text-sm">
                    📌
                  </span>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-plum-700">{e.body}</p>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-plum-500">
                    <span className="min-w-0 truncate">
                      <b className="font-normal text-blush-500">{e.author.nickname}</b> · <time dateTime={e.created_at}>{stamp(e.created_at)}</time>
                    </span>
                    {e.can_delete && (
                      <button type="button" onClick={() => void remove(e.id)} aria-label={`${e.author.nickname}님의 글 지우기`} className="shrink-0 rounded-full px-1.5 hover:bg-white/80 pointer-coarse:min-h-10 pointer-coarse:min-w-10">
                        지우기
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {hasMore && entries && (
              <Button variant="soft" className="w-full py-1.5" onClick={() => void load(entries[entries.length - 1]?.id)}>
                이전 글 더 보기
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
