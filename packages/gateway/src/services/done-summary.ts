/**
 * Filter engine "done" summaries that are pure lifecycle noise (Phase 6 extract).
 * Useful summaries become assistant transcript messages; boilerplate is dropped.
 */

const LIFECYCLE_SUMMARY =
  /^(Grok Build completed|Grok Build finished|Completed|EndTurn|Done\.?)$/i;
const LIFECYCLE_CODE = /^Grok Build finished \(code /i;

/**
 * True when a done.summary is worth showing as assistant text.
 */
export function isUsefulDoneSummary(summary: string | null | undefined): boolean {
  const s = (summary ?? "").trim();
  if (!s) return false;
  if (LIFECYCLE_SUMMARY.test(s)) return false;
  if (LIFECYCLE_CODE.test(s)) return false;
  return true;
}
