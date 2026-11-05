/**
 * The one font used everywhere (page UI and in-game text): 오뮤 다예쁨체
 * ("omyu pretty"), served from public/fonts and declared in index.css.
 * The fallbacks only show if the file fails to load.
 */
export const FONT_FAMILY = 'omyu pretty';
export const FONT_STACK = `"${FONT_FAMILY}", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;

/**
 * Resolves once the font is ready (or after `timeoutMs`), so Phaser text,
 * which is rasterized once when created, never bakes in a fallback font.
 */
export function loadGameFont(timeoutMs = 4000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  const load = document.fonts.load(`16px "${FONT_FAMILY}"`, '가A').then(() => undefined, () => undefined);
  return Promise.race([load, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}
