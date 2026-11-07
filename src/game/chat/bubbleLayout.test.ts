import { describe, expect, it } from 'vitest';
import { easeOffset, layoutBubbles, type BubbleArea, type BubbleWant } from './bubbleLayout';

const area: BubbleArea = { width: 400, height: 300, margin: 4, tail: 6, gap: 4, tailInset: 8 };
const want = (id: string, anchorX: number, anchorY: number, order: number, width = 100, height = 24): BubbleWant => ({ id, anchorX, anchorY, width, height, order });
const rect = (s: { x: number; y: number }, w = 100, h = 24) => ({ x: s.x, y: s.y, w, h });
const hit = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('speech bubble layout', () => {
  it('puts a lone bubble right above its speaker', () => {
    const s = layoutBubbles([want('a', 200, 200, 1)], area).get('a')!;
    expect(s).toEqual({ x: 150, y: 200 - 6 - 24, lifted: false, collapsed: false });
  });

  it('keeps the older bubble in place and moves the newer one out of the way', () => {
    const out = layoutBubbles([want('new', 210, 200, 2), want('old', 200, 200, 1)], area);
    const old = out.get('old')!;
    const nu = out.get('new')!;
    expect(old).toMatchObject({ x: 150, y: 170, lifted: false });
    expect(hit(rect(old), rect(nu))).toBe(false);
    expect(nu.collapsed).toBe(false);
  });

  it('slides sideways when that keeps the tail over the speaker, else stacks up', () => {
    // Speakers 70px apart: a slide is enough.
    let out = layoutBubbles([want('a', 150, 200, 1), want('b', 220, 200, 2)], area);
    expect(out.get('b')!.y).toBe(170);
    expect(out.get('b')!.lifted).toBe(false);
    // Same spot: has to go up, and is marked lifted (line down to the speaker).
    out = layoutBubbles([want('a', 200, 200, 1), want('b', 200, 200, 2)], area);
    expect(out.get('b')!.y).toBe(170 - 4 - 24);
    expect(out.get('b')!.lifted).toBe(true);
  });

  it('never overlaps with many speakers close together, collapsing what does not fit', () => {
    const wants = Array.from({ length: 10 }, (_, i) => want(`p${i}`, 180 + i * 6, 120, i));
    const out = layoutBubbles(wants, area);
    const shown = [...out.values()].filter((s) => !s.collapsed);
    for (let i = 0; i < shown.length; i++)
      for (let j = i + 1; j < shown.length; j++) expect(hit(rect(shown[i]!), rect(shown[j]!))).toBe(false);
    for (const s of shown) {
      expect(s.y).toBeGreaterThanOrEqual(area.margin);
      expect(s.x).toBeGreaterThanOrEqual(area.margin);
      expect(s.x + 100).toBeLessThanOrEqual(area.width - area.margin);
    }
    expect(shown.length).toBeGreaterThan(1);
    expect([...out.values()].some((s) => s.collapsed)).toBe(true);
  });

  it('stays inside the view at the edges', () => {
    const s = layoutBubbles([want('a', 2, 20, 1)], area).get('a')!;
    expect(s.x).toBe(4);
    expect(s.y).toBe(4);
  });

  it('is stable: the same input gives the same layout', () => {
    const wants = [want('a', 200, 200, 1), want('b', 205, 200, 2), want('c', 195, 210, 3)];
    expect(layoutBubbles(wants, area)).toEqual(layoutBubbles([...wants].reverse(), area));
  });

  it('eases offsets and settles', () => {
    let v = 0;
    v = easeOffset(v, 30, 16);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(30);
    for (let i = 0; i < 30; i++) v = easeOffset(v, 30, 16);
    expect(v).toBe(30);
  });
});
