import { describe, expect, it } from 'vitest';
import { keyboardInset } from './layout';

describe('keyboardInset', () => {
  it('is zero without a visual viewport or keyboard', () => {
    expect(keyboardInset(800, null)).toEqual({ top: 0, height: 800, bottom: 0 });
    expect(keyboardInset(800, { offsetTop: 0, height: 800 })).toEqual({ top: 0, height: 800, bottom: 0 });
  });

  it('measures the keyboard under a shrunken visual viewport', () => {
    // iOS: 844px layout, keyboard takes 336px.
    expect(keyboardInset(844, { offsetTop: 0, height: 508 })).toEqual({ top: 0, height: 508, bottom: 336 });
  });

  it('accounts for the page being panned up to show the focused field', () => {
    expect(keyboardInset(844, { offsetTop: 120, height: 508 })).toEqual({ top: 120, height: 508, bottom: 216 });
  });

  it('never goes negative (pinch zoom, rounding)', () => {
    expect(keyboardInset(800, { offsetTop: 10.4, height: 799.9 }).bottom).toBe(0);
  });
});
