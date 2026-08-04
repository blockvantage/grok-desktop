/**
 * Pure optional workspace root param parsing (Phase 6 extract).
 */

/**
 * Return string root when params.root is a non-empty string; else undefined.
 */
export function optionalWorkspaceRoot(
  params: { root?: unknown } | Record<string, unknown>,
): string | undefined {
  const root = (params as { root?: unknown }).root;
  return typeof root === "string" && root.length > 0 ? root : undefined;
}

/**
 * Label for workspace.ensureTemp — defaults to "chat".
 */
export function ensureTempWorkspaceLabel(
  params: { label?: unknown } | Record<string, unknown>,
): string {
  const label = (params as { label?: unknown }).label;
  return typeof label === "string" && label.trim() ? label : "chat";
}
