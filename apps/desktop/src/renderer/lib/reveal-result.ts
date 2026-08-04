/**
 * Map revealPath / open-in-Finder results to toast intent (Phase 6 extract).
 */

export type RevealResultLike = {
  ok: boolean;
  error?: string | null;
};

export type RevealToast =
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "info"; message: string };

/**
 * Decide toast after revealPath:
 * - not ok → destructive error
 * - ok with error string → soft info (e.g. opened parent)
 * - ok clean → no toast
 */
export function toastForRevealResult(
  res: RevealResultLike,
  fallbackError: string,
): RevealToast {
  if (!res.ok) {
    return { kind: "error", message: res.error || fallbackError };
  }
  if (res.error) {
    return { kind: "info", message: res.error };
  }
  return { kind: "none" };
}

/** Duration of the one-shot "done" celebrate animation (ms). */
export const CELEBRATE_DONE_MS = 1300;
