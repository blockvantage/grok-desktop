/**
 * Resolve which run attempt id to use when starting a task (Phase 6 extract).
 */

export type AttemptLike = {
  id: string;
  status: string;
};

/**
 * A durable claim is the only authority to start. Never fall back to a row
 * another gateway may have leased between the snapshot and the claim.
 */
export function resolveAttemptIdForStart(input: {
  latest: AttemptLike | null | undefined;
  claimed: AttemptLike | null | undefined;
  isTerminal: (status: string) => boolean;
}): string | null {
  return input.claimed?.id ?? null;
}

/** Normalize thrown values to a short error message for task events. */
export function errorMessageFromUnknown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
