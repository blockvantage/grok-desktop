/**
 * Canonical process targets for Desk-managed Grok runtime selection.
 *
 * Artifact selection uses `process.platform` + `process.arch` (the running
 * binary), not host CPU — an x64 Desk under Rosetta receives x64 Grok.
 */

export const CANONICAL_RUNTIME_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
  "win32-arm64",
] as const;

export type CanonicalRuntimeTarget = (typeof CANONICAL_RUNTIME_TARGETS)[number];

/** Launch-qualified publication targets. win32-arm64 stays unpublished. */
export const QUALIFIED_PUBLICATION_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
] as const;

export type QualifiedPublicationTarget =
  (typeof QUALIFIED_PUBLICATION_TARGETS)[number];

export type RuntimeTarget = CanonicalRuntimeTarget | "unsupported";

const CANONICAL_SET = new Set<string>(CANONICAL_RUNTIME_TARGETS);
const QUALIFIED_SET = new Set<string>(QUALIFIED_PUBLICATION_TARGETS);

export function isCanonicalRuntimeTarget(
  value: string,
): value is CanonicalRuntimeTarget {
  return CANONICAL_SET.has(value);
}

export function isQualifiedPublicationTarget(
  value: string,
): value is QualifiedPublicationTarget {
  return QUALIFIED_SET.has(value);
}

/**
 * True when a target appears in a signed manifest's publishedTargets list.
 * win32-arm64 remains a valid type but is unpublished until qualification.
 */
export function isPublishedTarget(
  target: string,
  publishedTargets: readonly string[],
): boolean {
  return publishedTargets.includes(target);
}

/**
 * Map Node/Electron `process.platform` + `process.arch` to a runtime target.
 * Unknown combinations return `"unsupported"` (never invent a cross-arch pair).
 */
export function toRuntimeTarget(platform: string, arch: string): RuntimeTarget {
  const p = platform.toLowerCase();
  const a = arch.toLowerCase();
  const key = `${p}-${a}`;
  if (isCanonicalRuntimeTarget(key)) return key;
  return "unsupported";
}
