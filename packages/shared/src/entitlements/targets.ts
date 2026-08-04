/**
 * Canonical Desk / Grok runtime targets — matches landing OpenAPI enum.
 */

export const CANONICAL_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
  "win32-arm64",
] as const;

export type CanonicalTarget = (typeof CANONICAL_TARGETS)[number];

export function isCanonicalTarget(value: string): value is CanonicalTarget {
  return (CANONICAL_TARGETS as readonly string[]).includes(value);
}
