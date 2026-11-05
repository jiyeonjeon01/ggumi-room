/**
 * Chat messages and how they travel, kept apart from how they are shown
 * (SpeechBubble). Today messages only loop back inside the browser
 * (LocalChatTransport); a WebSocketChatTransport can replace it later
 * without touching the UI or the bubbles. Pure TypeScript, no Phaser/DOM.
 */

export interface ChatMessage {
  id: string;
  playerId: string;
  content: string;
  /**
   * Client time (ms since epoch). A real server must not trust this or
   * `playerId` from the client: it should stamp both from the authenticated
   * session and its own clock before broadcasting.
   */
  createdAt: number;
}

export interface ChatTransport {
  send(message: ChatMessage): void;
  /** Subscribes to delivered messages (own and, later, other players'). Returns an unsubscribe function. */
  onMessage(listener: (message: ChatMessage) => void): () => void;
  destroy(): void;
}

/** Max message length in characters (code points, so a Korean syllable counts as one). */
export const MAX_CHAT_LENGTH = 24;
/** How long a speech bubble stays up. */
export const BUBBLE_MS = 5000;

/** Cuts a string to at most `max` code points without splitting surrogate pairs. */
export function clampChars(text: string, max = MAX_CHAT_LENGTH): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

export function charCount(text: string): number {
  return Array.from(text).length;
}

/** Cleans user input; returns null for messages that should not be sent (empty or whitespace only). */
export function normalizeChat(text: string): string | null {
  const clean = clampChars(text.replace(/\s+/g, ' ').trim());
  return clean ? clean : null;
}

let seq = 0;
export function createChatMessage(playerId: string, content: string, now = Date.now()): ChatMessage {
  seq++;
  return { id: `${now.toString(36)}-${seq}`, playerId, content, createdAt: now };
}

/** Delivers every sent message straight back to local listeners. No network, no storage. */
export class LocalChatTransport implements ChatTransport {
  private listeners = new Set<(message: ChatMessage) => void>();

  send(message: ChatMessage): void {
    for (const l of this.listeners) l(message);
  }

  onMessage(listener: (message: ChatMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.listeners.clear();
  }
}

/**
 * Splits text into lines no wider than `maxWidth` using real measured widths
 * (so Korean, Latin and emoji wrap correctly). Breaks after a space when one
 * is available on the line, otherwise between any two characters.
 */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of Array.from(text)) {
    if (line && measure(line + ch) > maxWidth) {
      const space = line.lastIndexOf(' ');
      if (space > 0 && ch !== ' ') {
        lines.push(line.slice(0, space));
        line = line.slice(space + 1) + ch;
      } else {
        lines.push(line.trimEnd());
        line = ch === ' ' ? '' : ch;
      }
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Wraps into at most `maxLines`, widening the box past `maxWidth` only when
 * the text would not fit otherwise (very wide characters), so nothing is
 * ever cut off.
 */
export function layoutBubble(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines = 2,
): { lines: string[]; width: number } {
  let limit = maxWidth;
  let lines = wrapLines(text, limit, measure);
  while (lines.length > maxLines) {
    limit += 4;
    lines = wrapLines(text, limit, measure);
  }
  return { lines, width: Math.ceil(Math.max(...lines.map(measure))) };
}
