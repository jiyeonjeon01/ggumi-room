import { useEffect, useReducer, useState } from 'react';
import { drawFurniture } from '../game/art/furnitureArt';
import { THEMES, type ThemeId } from '../game/art/themes';
import type { EditResult, LayoutEditor } from '../game/core/layoutEditor';
import { catalogEntry, FURNITURE_TYPES, LAYOUT_ERROR_TEXT, type FurnitureType } from '../game/core/placement';
import { Button, Modal } from './ui';

/** Re-renders when the edit session changes. */
function useEditor(editor: LayoutEditor) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => editor.subscribe(bump), [editor]);
  return editor;
}

const thumbs = new Map<string, string>();
/** Small preview of a piece, drawn by the same generator as the game (facing 0). */
function thumbnail(type: FurnitureType, theme: ThemeId): string {
  const key = `${type}:${theme}`;
  let url = thumbs.get(key);
  if (!url) {
    url = drawFurniture(type, THEMES[theme]).toDataURL();
    thumbs.set(key, url);
  }
  return url;
}

export interface EditorProps {
  editor: LayoutEditor;
  theme: ThemeId;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** Shows a short message (refused moves etc.). */
  onNotice: (message: string) => void;
}

const report = (result: EditResult, notice: (m: string) => void) => {
  if (!result.ok) notice(LAYOUT_ERROR_TEXT[result.error.code]);
};

/** Catalog of free furniture: every type can be added any number of times (within the room limit). */
function Catalog({ editor, theme, onNotice, onAdded }: Pick<EditorProps, 'editor' | 'theme' | 'onNotice'> & { onAdded?: () => void }) {
  return (
    <ul aria-label="가구 추가" className="grid grid-cols-3 gap-2">
      {FURNITURE_TYPES.map((type) => (
        <li key={type}>
          <button
            type="button"
            onClick={() => {
              const r = editor.add(type);
              report(r, onNotice);
              if (r.ok) onAdded?.();
            }}
            className="flex w-full flex-col items-center gap-1 rounded-2xl bg-white px-1 py-2 text-xs text-plum-700 ring-1 ring-blush-100 hover:bg-blush-50 hover:ring-blush-200"
          >
            <img src={thumbnail(type, theme)} alt="" className="h-10 w-auto object-contain [image-rendering:pixelated]" />
            {catalogEntry(type).name}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Moves the selected piece one grid step along the room's axes. The arrows
 * point the way the piece goes on screen (the floor is diamond-shaped).
 */
function NudgePad({ editor, onNotice, compact = false }: Pick<EditorProps, 'editor' | 'onNotice'> & { compact?: boolean }) {
  const sel = editor.selected;
  const step = (dx: number, dy: number) => sel && report(editor.nudge(sel.uid, dx, dy), onNotice);
  const btn = `flex items-center justify-center rounded-xl bg-white text-plum-700 ring-1 ring-blush-200 hover:bg-blush-50 disabled:opacity-40 ${compact ? 'h-9 w-9' : 'h-10 w-10'}`;
  return (
    <div role="group" aria-label="선택한 가구 옮기기" className="grid grid-cols-2 gap-1">
      <button type="button" className={btn} disabled={!sel} onClick={() => step(-1, 0)} aria-label="왼쪽 위로 옮기기">↖</button>
      <button type="button" className={btn} disabled={!sel} onClick={() => step(0, -1)} aria-label="오른쪽 위로 옮기기">↗</button>
      <button type="button" className={btn} disabled={!sel} onClick={() => step(0, 1)} aria-label="왼쪽 아래로 옮기기">↙</button>
      <button type="button" className={btn} disabled={!sel} onClick={() => step(1, 0)} aria-label="오른쪽 아래로 옮기기">↘</button>
    </div>
  );
}

/** Desktop: the left panel while decorating. */
export function EditorPanel(props: EditorProps) {
  const { editor, saving, onSave, onCancel, onNotice } = props;
  useEditor(editor);
  const sel = editor.selected;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg text-plum-700">🛋 방 꾸미기</p>
        <p className="text-xs leading-relaxed text-plum-500">가구를 눌러 고르고 끌어서 옮겨요. 저장하기 전까지는 나만 보여요.</p>
      </div>

      <section aria-label="선택한 가구" className="rounded-2xl bg-white px-3 py-2.5 ring-1 ring-blush-100">
        {sel ? (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="truncate text-plum-700">{catalogEntry(sel.type).name}</p>
              <div className="flex gap-1">
                <Button variant="soft" className="px-3 py-1" onClick={() => report(editor.rotate(sel.uid), onNotice)}>
                  ⟳ 돌리기
                </Button>
                <Button variant="soft" className="px-3 py-1" onClick={() => report(editor.remove(sel.uid), onNotice)}>
                  🗑 빼기
                </Button>
              </div>
            </div>
            <NudgePad editor={editor} onNotice={onNotice} />
          </div>
        ) : (
          <p className="py-1 text-sm text-plum-500">방에서 가구를 눌러 골라 주세요.</p>
        )}
      </section>

      <section>
        <p className="mb-1.5 text-sm text-plum-500">가구 추가</p>
        <Catalog {...props} />
        <p className="mt-1.5 text-[11px] text-plum-500/80">뺀 가구는 언제든 여기서 다시 추가할 수 있어요.</p>
      </section>

      <div className="space-y-2">
        <Button variant="soft" className="w-full" disabled={!editor.canUndo} onClick={() => editor.undo()}>
          ↶ 되돌리기
        </Button>
        <div className="flex gap-2">
          <Button variant="soft" className="flex-1" onClick={onCancel} disabled={saving}>
            취소
          </Button>
          <Button className="flex-1" onClick={onSave} disabled={saving || !editor.dirty}>
            {saving ? '저장 중…' : '저장하기'}
          </Button>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-plum-500/80">
        단축키: R 돌리기 · Delete 빼기 · 방향키 한 칸 이동 · Ctrl+Z 되돌리기 · Esc 선택 해제
      </p>
    </div>
  );
}

/** Tablet/mobile: a toolbar under the game while decorating (the game stays fully visible). */
export function EditBar(props: EditorProps) {
  const { editor, saving, onSave, onCancel, onNotice } = props;
  useEditor(editor);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const sel = editor.selected;
  return (
    <div aria-label="방 꾸미기 도구" role="toolbar" className="shrink-0 space-y-2 rounded-[24px] bg-white/80 p-2 shadow-sm ring-1 ring-blush-200">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-plum-700">{sel ? catalogEntry(sel.type).name : '🛋 가구를 눌러 골라요'}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Button variant="soft" className="px-3 py-1" onClick={() => setCatalogOpen(true)}>
              ＋ 가구
            </Button>
            <Button variant="soft" className="px-3 py-1" disabled={!editor.canUndo} onClick={() => editor.undo()} aria-label="되돌리기">
              ↶
            </Button>
            <Button variant="soft" className="px-3 py-1" disabled={!sel} onClick={() => sel && report(editor.rotate(sel.uid), onNotice)} aria-label="돌리기">
              ⟳
            </Button>
            <Button variant="soft" className="px-3 py-1" disabled={!sel} onClick={() => sel && report(editor.remove(sel.uid), onNotice)} aria-label="빼기">
              🗑
            </Button>
          </div>
        </div>
        <NudgePad editor={editor} onNotice={onNotice} compact />
      </div>
      <div className="flex gap-2">
        <Button variant="soft" className="flex-1 py-1.5" onClick={onCancel} disabled={saving}>
          취소
        </Button>
        <Button className="flex-1 py-1.5" onClick={onSave} disabled={saving || !editor.dirty}>
          {saving ? '저장 중…' : '저장하기'}
        </Button>
      </div>
      {catalogOpen && (
        <Modal title="가구 추가" onClose={() => setCatalogOpen(false)}>
          <Catalog {...props} onAdded={() => setCatalogOpen(false)} />
          <p className="mt-2 text-[11px] text-plum-500/80">뺀 가구는 언제든 여기서 다시 추가할 수 있어요.</p>
        </Modal>
      )}
    </div>
  );
}

/** Keyboard shortcuts while decorating (ignored while typing in a field). */
export function useEditorKeys(editor: LayoutEditor | null, onNotice: (m: string) => void, onEscapeEmpty: () => void): void {
  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const sel = editor.selected;
      const run = (r: EditResult) => report(r, onNotice);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        editor.undo();
        return;
      }
      if (e.key === 'Escape') {
        if (sel) editor.select(null);
        else onEscapeEmpty();
        return;
      }
      if (!sel) return;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        run(editor.nudge(sel.uid, m[0], m[1]));
      } else if (e.key === 'r' || e.key === 'R') {
        run(editor.rotate(sel.uid));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        run(editor.remove(sel.uid));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, onNotice, onEscapeEmpty]);
}
