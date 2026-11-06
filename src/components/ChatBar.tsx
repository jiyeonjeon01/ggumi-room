import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTouchDevice } from '../app/layout';
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
 *
 * Phones have no Enter to open it: a tap focuses the input (it is never
 * read-only, or the virtual keyboard wouldn't come up), and the send button or
 * the keyboard's send key submits the form.
 */
export function ChatBar({ onSend }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  /** When a message was last sent: an Enter right after (a duplicate IME Enter) must not reopen the bar or send again. */
  const sentAt = useRef(0);
  const touch = useTouchDevice();

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
    // Blur first: it ends any IME composition, whose final input event must
    // land before the text is cleared or the last syllable comes back.
    inputRef.current?.blur();
    setText('');
    setOpen(false);
  };

  /** Sends what is in the field now (the DOM value includes a syllable still being composed). */
  const send = () => {
    if (performance.now() - sentAt.current < 250) return;
    const value = clampChars(inputRef.current?.value ?? text);
    if (onSend(value)) {
      sentAt.current = performance.now();
      close();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // keyCode 229 = IME still composing (some browsers don't set isComposing).
    if (e.nativeEvent.isComposing || e.keyCode === 229 || composing.current) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) setOpen(true);
      else send();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const count = charCount(text);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
      <form
        // Implicit submission: a phone keyboard's send/go key, also mid-composition.
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className={`pointer-events-auto flex w-full max-w-xs items-center gap-2 rounded-full py-1.5 pl-3 shadow-sm ring-1 transition-colors ${
          open && touch ? 'pr-1.5' : 'pr-3'
        } ${open ? 'bg-white/95 ring-blush-400' : 'bg-white/70 ring-blush-200'}`}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <span aria-hidden className="text-sm">💬</span>
        <input
          ref={inputRef}
          value={text}
          aria-label="채팅 입력"
          enterKeyHint="send"
          autoComplete="off"
          placeholder={open ? '메시지를 입력하세요' : touch ? '눌러서 채팅하기' : 'Enter로 채팅하기'}
          onFocus={() => setOpen(true)}
          onChange={(e) => setText(composing.current ? e.target.value : clampChars(e.target.value))}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={(e) => {
            composing.current = false;
            setText(clampChars(e.currentTarget.value));
          }}
          onKeyDown={onKeyDown}
          // 16px on touch screens: iOS zooms the page in on smaller text fields.
          className="min-w-0 flex-1 bg-transparent text-sm text-plum-700 outline-none placeholder:text-plum-500/70 pointer-coarse:text-base"
        />
        {open && (
          <span className={`text-[11px] tabular-nums ${count >= MAX_CHAT_LENGTH ? 'text-blush-500' : 'text-plum-500'}`}>
            {Math.min(count, MAX_CHAT_LENGTH)}/{MAX_CHAT_LENGTH}
          </span>
        )}
        {open && touch && (
          <button
            type="submit"
            aria-label="말풍선 보내기"
            // Keep focus (and the keyboard) on the input: a blur here would
            // close the keyboard and shift the layout under the finger.
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            // The form's own click handler would reopen the bar after sending.
            onClick={(e) => e.stopPropagation()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-400 text-white shadow active:bg-blush-500"
          >
            <span aria-hidden>↑</span>
          </button>
        )}
      </form>
    </div>
  );
}
