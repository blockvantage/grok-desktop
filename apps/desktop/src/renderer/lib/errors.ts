/**
 * Map thrown errors / raw messages to short recovery copy for toasts.
 * Never surface stack traces or engine internals to the user.
 */

import { looksLikeEngineDump } from "@grokdesk/shared";
import { recoveryFromErrorMessage } from "@/lib/error-recovery";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function humanizeError(
  error: unknown,
  t: Translate = (k) => k,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return t("errors.generic");

  const recovery = recoveryFromErrorMessage(trimmed, t);
  if (recovery.kind !== "generic") {
    return recovery.body || recovery.title;
  }

  // Known gateway / network patterns
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("econnrefused") ||
    (lower.includes("gateway") && lower.includes("not ready")) ||
    lower.includes("socket hang up")
  ) {
    return t("errors.gateway");
  }
  if (lower.includes("network") || lower.includes("fetch failed")) {
    return t("errors.network");
  }
  if (lower.includes("permission") || lower.includes("not allowed")) {
    return t("errors.permission");
  }

  if (looksLikeEngineDump(trimmed)) {
    return t("errors.generic");
  }

  // Keep short plain messages; drop stack-ish multi-line dumps.
  if (trimmed.includes("\n") || trimmed.length > 160) {
    return t("errors.generic");
  }
  // If it looks like a code or path dump, genericize.
  if (/^[A-Z_]+$/.test(trimmed) || /\/Users\//.test(trimmed)) {
    return t("errors.generic");
  }
  return trimmed;
}
