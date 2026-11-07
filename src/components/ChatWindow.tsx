import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { deliveryOf, useChat, type ThreadMessage } from '../app/chat';
import { useKeyboardInset, useLayoutMode } from '../app/layout';
import { useLive } from '../app/live';
import { SafetyModal } from './Safety';

const MAX_CHARS = 500;

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** Sending: spinner. Stored, not read: faint check. Read: deep check. */
function Status({ m, peerReadSeq }: { m: ThreadMessage; peerReadSeq: number }) {
  const d = deliveryOf(m, peerReadSeq);
  const read = d === 'read';
  if (d === 'sending') {
    return <span role="img" aria-label="보내는 중" className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-blush-300 border-t-transparent" />;
  }
  if (d === 'failed') return null;
  return (
    <span role="img" aria-label={read ? '읽음' : '전송됨'} data-read={read} className={read ? 'text-blush-500' : 'text-blush-200'}>
      ✓
    </span>
  );
}

function TypingDots({ name }: { name: string }) {
  return (
    <p className="flex items-center gap-1 px-3 pb-1 text-xs text-plum-500" aria-live="polite">
      {name}님이 입력 중
      <span aria-hidden className="inline-flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1 w-1 animate-[ggumi-dot_1.2s_ease-in-out_infinite] rounded-full bg-plum-400" style={{ animationDelay: `${i * 0.18}s` }} />
        ))}
      </span>
    </p>
  );
}

/**
 * The open 1:1 chat. Desktop: a small window at the bottom right (over the
 * friends panel, not the game). Phone/tablet: a sheet over the lower part of
 * the screen. Minimized: a pill with the unread count.
 *
 * Read receipts: the friend's messages count as read only while this window
 * is open (not minimized), the tab is visible and focused, and the newest
 * message is scrolled into view.
 */
export function ChatWindow() {
  const chat = useChat();
  const { presence } = useLive();
  const mode = useLayoutMode();
  const keyboard = useKeyboardInset();
  const { open, thread } = chat;
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [atBottom, setAtBottom] = useState(true);
  /** Report / block this friend. */
  const [safety, setSafety] = useState(false);
  const composing = useRef(false);
  const friendId = open?.friend.id;

  // New friend: fresh input, scrolled to the bottom.
  useEffect(() => {
    setText('');
    setAtBottom(true);
    setSafety(false);
    if (open && !open.minimized) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendId]);

  // Keep the newest message in view when already at the bottom.
  const count = thread?.messages.length ?? 0;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, friendId, open?.minimized, thread?.loading]);

  // Mark read only when the person can actually see the messages.
  useEffect(() => {
    if (!open || open.minimized || !thread) return;
    const check = () => {
      if (document.visibilityState === 'visible' && document.hasFocus() && atBottom) chat.markRead();
    };
    check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [open, thread, count, atBottom, chat]);

  if (!open) return null;
  const { friend } = open;
  const unread = chat.unread[friend.id] ?? 0;
  const status = presence[friend.id];
  const dot = status === 'online' ? 'bg-emerald-400' : status === 'away' ? 'bg-amber-300' : status === 'offline' ? 'bg-gray-300' : 'border-2 border-gray-300 bg-white';

  if (open.minimized) {
    return (
      <button
        type="button"
        onClick={() => chat.setMinimized(false)}
        aria-label={`${friend.nickname}님과의 채팅 열기${unread ? `, 읽지 않은 메시지 ${unread}개` : ''}`}
        className={`fixed right-4 z-40 flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm text-plum-700 shadow-lg ring-1 ring-blush-200 hover:bg-blush-50 ${
          // Phone: above the room's chat bar and the tab bar, not over them.
          mode === 'mobile' ? 'bottom-32 min-h-10' : 'bottom-4'
        }`}
      >
        <span aria-hidden>💬</span>
        {friend.nickname}
        {unread > 0 && <span className="rounded-full bg-blush-500 px-1.5 text-[11px] leading-5 text-white">{unread}</span>}
      </button>
    );
  }

  const send = () => {
    const body = text.trim();
    if (!body || Array.from(body).length > MAX_CHARS) return;
    chat.send(body);
    // Clearing while a phone IME still composes brings the last syllable
    // back; a quick blur/refocus ends the composition and keeps the keyboard.
    const el = inputRef.current;
    if (composing.current && el) {
      el.blur();
      el.focus();
    }
    setText('');
    setAtBottom(true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter breaks the line; never in the middle of Korean composition.
    if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      chat.setMinimized(true);
    }
    e.stopPropagation(); // the room's own Enter-to-chat and decorating keys stay out of it
  };
  const chars = Array.from(text).length;
  const sheet = mode === 'mobile';
  // Phone keyboard up: the sheet fills the visible part above it, or the input would sit under the keys.
  const sheetStyle = sheet && keyboard.bottom > 0 ? { top: keyboard.top + 8, bottom: keyboard.bottom + 8 } : undefined;
  const typing = chat.typing[friend.id];

  return (
    <>
      {/* A region, not a dialog: it doesn't block the room (decorating shortcuts check for open dialogs). */}
      <section
        role="region"
        aria-label={`${friend.nickname}님과의 채팅`}
        style={sheetStyle}
        className={`fixed z-40 flex flex-col overflow-hidden bg-cream shadow-2xl ring-4 ring-white ${
          sheet ? 'inset-x-2 bottom-2 top-[30%] rounded-[24px]' : 'bottom-4 right-4 h-[440px] max-h-[calc(100vh-2rem)] w-[320px] rounded-[24px]'
        }`}
      >
        <header className="flex items-center gap-2 border-b border-blush-100 bg-white/80 px-3 py-2">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${dot}`} />
          <h2 className="min-w-0 flex-1 truncate text-plum-700">{friend.nickname}</h2>
          <button type="button" onClick={() => setSafety(true)} aria-label={`${friend.nickname}님 신고·차단`} title="신고·차단" className="rounded-full px-2 text-sm text-plum-500 hover:bg-blush-100 pointer-coarse:min-h-10 pointer-coarse:min-w-10">
            🚩
          </button>
          <button type="button" onClick={() => chat.setMinimized(true)} aria-label="채팅 최소화" className="rounded-full px-2 text-plum-500 hover:bg-blush-100 pointer-coarse:min-h-10 pointer-coarse:min-w-10">
            ─
          </button>
          <button type="button" onClick={() => chat.closeChat()} aria-label="채팅 닫기" className="rounded-full px-2 text-xl leading-none text-plum-500 hover:bg-blush-100 pointer-coarse:min-h-10 pointer-coarse:min-w-10">
            ×
          </button>
        </header>

        <div
          ref={listRef}
          role="log"
          aria-label="대화 내용"
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
          className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2"
        >
          {thread?.hasMore && (
            <button type="button" onClick={() => void chat.loadOlder()} className="mx-auto block rounded-full px-3 py-1 text-xs text-plum-500 hover:bg-blush-100">
              이전 메시지 더 보기
            </button>
          )}
          {thread && !thread.loading && thread.messages.length === 0 && (
            <p className="py-6 text-center text-xs text-plum-500">아직 나눈 이야기가 없어요. 먼저 인사해 볼까요?</p>
          )}
          {thread?.messages.map((m) => {
            return (
              <div key={m.key} data-key={m.key} className={`flex items-end gap-1 ${m.mine ? 'flex-row-reverse' : ''}`}>
                <p
                  className={`max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm ${
                    m.mine ? 'rounded-br-md bg-blush-400 text-white' : 'rounded-bl-md bg-white text-plum-700 ring-1 ring-blush-100'
                  } ${m.state === 'failed' ? 'opacity-60' : ''}`}
                >
                  {m.body}
                </p>
                <span className={`flex shrink-0 flex-col pb-0.5 text-[10px] leading-tight text-plum-500/80 ${m.mine ? 'items-end' : 'items-start'}`}>
                  {m.mine && <Status m={m} peerReadSeq={thread.peerReadSeq} />}
                  {m.state === 'failed' ? (
                    <button type="button" onClick={() => chat.retry(m.key)} className="text-blush-500 underline underline-offset-2" title={m.error}>
                      다시 보내기
                    </button>
                  ) : (
                    <time dateTime={m.createdAt}>{timeLabel(m.createdAt)}</time>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {typing && <TypingDots name={friend.nickname} />}
        <form
          onSubmit={(e) => (e.preventDefault(), send())}
          className="flex items-end gap-2 border-t border-blush-100 bg-white/80 p-2"
        >
          <label className="sr-only" htmlFor="dm-input">
            메시지
          </label>
          <textarea
            id="dm-input"
            ref={inputRef}
            rows={1}
            value={text}
            maxLength={MAX_CHARS * 2}
            enterKeyHint="send"
            placeholder="메시지를 입력해요"
            onChange={(e) => {
              setText(e.target.value);
              chat.setTyping(e.target.value.trim().length > 0);
            }}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onKeyDown={onKeyDown}
            onBlur={() => chat.setTyping(false)}
            className="max-h-24 min-h-9 flex-1 resize-none rounded-2xl bg-white px-3 py-2 text-sm text-plum-700 pointer-coarse:min-h-10 pointer-coarse:text-base ring-1 ring-blush-200 outline-none focus:ring-blush-400"
          />
          <button
            type="submit"
            disabled={!text.trim() || chars > MAX_CHARS}
            // Keep focus in the input so the phone keyboard stays up between messages.
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            className="shrink-0 rounded-full bg-blush-400 px-3 py-2 text-sm text-white shadow hover:bg-blush-500 disabled:bg-blush-200 pointer-coarse:min-h-10 pointer-coarse:px-4"
          >
            보내기
          </button>
        </form>
        {chars > MAX_CHARS - 50 && (
          <p className={`px-3 pb-1 text-right text-[10px] ${chars > MAX_CHARS ? 'text-blush-500' : 'text-plum-500'}`}>
            {chars}/{MAX_CHARS}
          </p>
        )}
      </section>
      {safety && <SafetyModal user={friend} context="chat" onClose={() => setSafety(false)} onBlocked={() => chat.closeChat()} />}
    </>
  );
}
