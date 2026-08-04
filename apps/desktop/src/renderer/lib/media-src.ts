/**
 * Display helpers for media element sources.
 */

/** First-frame fragment so <video> paints a poster without a poster file. */
export function videoDisplaySrc(src: string): string {
  if (!src || src.startsWith("data:") || src.includes("#t=")) return src;
  return `${src}#t=0.001`;
}
