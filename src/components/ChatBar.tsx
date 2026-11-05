import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { charCount, clampChars, MAX_CHAT_LENGTH } from '../game/chat/chat';

interface Props {
  /** Sends the text; returns false when it was empty (the bar then stays open). */
  onSend: (text: string) => boolean;
}

/**
 * Small chat input docked at the bottom of the room. Closed, it shows a hint;
 * Enter opens it (unless another text field has focus), Enter sends, Esc
 * cancels. Enter pressed while composing Hangul (IME) only finishes the
 * syllable. Nothing is stored: the text lives in this component's state.
 */
export function ChatBar({ onSend }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  /** When a message was last sent: an Enter right after (a duplicate IME Enter) must not reopen the bar. */
  const sentAt = useRef(0);

  // Global Enter opens the bar. Runs on keydown, and the input only reacts to
  // its own later keydowns, so the opening Enter can never also send.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.isComposing || e.defaultPrevented) return;
      if (performance.now() - sentAt.current < 250) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault(); // don't also "click" a focused button
      setOpen(true);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setText('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // keyCode 229 = IME still composing (some browsers don't set isComposing).
    if (e.nativeEvent.isComposing || e.keyCode === 229 || composing.current) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) setOpen(true);
      else if (onSend(text)) {
        sentAt.current = performance.now();
        close();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const count = charCount(text);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
      <form
        onSubmit={(e) => e.preventDefault()}
        className={`pointer-events-auto flex w-full max-w-xs items-center gap-2 rounded-full px-3 py-1.5 shadow-sm ring-1 transition-colors ${
          open ? 'bg-white/95 ring-blush-400' : 'bg-white/70 ring-blush-200'
        }`}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <span aria-hidden className="text-sm">💬</span>
        <input
          ref={inputRef}
          value={text}
          readOnly={!open}
          aria-label="채팅 입력"
          placeholder={open ? '메시지를 입력하세요' : 'Enter로 채팅하기'}
          onChange={(e) => setText(composing.current ? e.target.value : clampChars(e.target.value))}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={(e) => {
            composing.current = false;
            setText(clampChars(e.currentTarget.value));
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm text-plum-700 outline-none placeholder:text-plum-500/70"
        />
        {open && (
          <span className={`text-[11px] tabular-nums ${count >= MAX_CHAT_LENGTH ? 'text-blush-500' : 'text-plum-500'}`}>
            {Math.min(count, MAX_CHAT_LENGTH)}/{MAX_CHAT_LENGTH}
          </span>
        )}
      </form>
    </div>
  );
}
