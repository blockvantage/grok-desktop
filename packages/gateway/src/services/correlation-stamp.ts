/**
 * Stamp operation / audit detail objects with bounded correlation fields (OPS).
 * Never includes secrets — only opaque ids from CorrelationChain.
 */
import {
  correlationLogFields,
  type CorrelationChain,
} from "@grokdesk/shared";

/**
 * Merge correlation log fields into a detail record without overwriting
 * existing non-empty detail keys that already match.
 */
export function stampDetailWithCorrelation(
  detail: Record<string, unknown>,
  chain: CorrelationChain,
): Record<string, unknown> {
  const fields = correlationLogFields(chain);
  const out: Record<string, unknown> = { ...detail };
  for (const [k, v] of Object.entries(fields)) {
    if (out[k] === undefined || out[k] === null || out[k] === "") {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Build a minimal chain from request/task/attempt ids (common gateway path).
 */
export function chainFromIds(ids: {
  requestId: string;
  taskId?: string | null;
  runAttemptId?: string | null;
  providerSessionId?: string | null;
  turnId?: string | null;
}): CorrelationChain {
  const chain: CorrelationChain = { requestId: ids.requestId };
  if (ids.taskId) chain.taskId = ids.taskId;
  if (ids.runAttemptId) chain.runAttemptId = ids.runAttemptId;
  if (ids.providerSessionId) chain.providerSessionId = ids.providerSessionId;
  if (ids.turnId) chain.turnId = ids.turnId;
  return chain;
}
