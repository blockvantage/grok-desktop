/**
 * External docs URL for command palette / help (Phase 6 extract).
 */

export const GROK_BUILD_DOCS_URL = "https://docs.x.ai/build/overview";

/**
 * Open docs with safe window features (noopener).
 */
export function openDocsWindow(
  open: typeof window.open = (...args) => window.open(...args),
): void {
  open(GROK_BUILD_DOCS_URL, "_blank", "noopener,noreferrer");
}
