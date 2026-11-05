import { describe, expect, it } from 'vitest';
import {
  charCount,
  clampChars,
  createChatMessage,
  layoutBubble,
  LocalChatTransport,
  MAX_CHAT_LENGTH,
  normalizeChat,
  wrapLines,
  type ChatMessage,
} from './chat';

/** Fake font: Hangul 6px, everything else 3px (like a real proportional font, roughly). */
const measure = (s: string) => Array.from(s).reduce((w, c) => w + (/[가-힣]/.test(c) ? 6 : 3), 0);

describe('chat messages', () => {
  it('rejects empty and whitespace-only messages', () => {
    expect(normalizeChat('')).toBeNull();
    expect(normalizeChat('   \n\t ')).toBeNull();
    expect(normalizeChat('  안녕  ')).toBe('안녕');
    expect(normalizeChat('안녕\n\n놀러 와')).toBe('안녕 놀러 와');
  });

  it('limits messages to 24 characters, counting Hangul and emoji as one', () => {
    const long = '가'.repeat(30);
    expect(charCount(clampChars(long))).toBe(MAX_CHAT_LENGTH);
    expect(normalizeChat(long)).toBe('가'.repeat(24));
    const emoji = '🌸'.repeat(30);
    expect(charCount(clampChars(emoji))).toBe(24);
    expect(clampChars(emoji)).toBe('🌸'.repeat(24)); // no broken surrogate pairs
    expect(clampChars('짧은 말')).toBe('짧은 말');
  });

  it('creates unique ids', () => {
    const a = createChatMessage('p1', 'hi', 1000);
    const b = createChatMessage('p1', 'hi', 1000);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ playerId: 'p1', content: 'hi', createdAt: 1000 });
  });

  it('delivers messages locally until unsubscribed or destroyed', () => {
    const t = new LocalChatTransport();
    const got: ChatMessage[] = [];
    const off = t.onMessage((m) => got.push(m));
    t.send(createChatMessage('p1', 'a'));
    off();
    t.send(createChatMessage('p1', 'b'));
    expect(got.map((m) => m.content)).toEqual(['a']);
    t.onMessage((m) => got.push(m));
    t.destroy();
    t.send(createChatMessage('p1', 'c'));
    expect(got).toHaveLength(1);
  });
});

describe('bubble layout', () => {
  it('wraps by measured width, preferring spaces', () => {
    expect(wrapLines('안녕! 내 방에 놀러 와', 40, measure)).toEqual(['안녕! 내 방에', '놀러 와']);
    for (const line of wrapLines('가나다라마바사아자차카타파하', 30, measure)) expect(measure(line)).toBeLessThanOrEqual(30);
  });

  it('keeps any 24-character message within 2 lines without cutting text', () => {
    for (const text of ['가'.repeat(24), 'a'.repeat(24), '안녕! 내 방에 놀러 와 같이 놀자 헤헤', '🌸'.repeat(24)]) {
      const { lines, width } = layoutBubble(text, 74, measure);
      expect(lines.length).toBeLessThanOrEqual(2);
      expect(lines.join('').replace(/ /g, '')).toBe(text.replace(/ /g, ''));
      for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(width);
    }
  });

  it('sizes short messages to their content', () => {
    const { lines, width } = layoutBubble('안녕', 74, measure);
    expect(lines).toEqual(['안녕']);
    expect(width).toBe(12);
  });
});
