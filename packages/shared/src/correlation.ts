/**
 * Bounded correlation chain for observability (OPS / Phase 6 foundations).
 * UI action → request → task → turn → run attempt → provider session →
 * operation → artifact → remote receipt.
 *
 * Browser-safe (no node: builtins).
 */

export interface CorrelationChain {
  uiActionId?: string;
  requestId: string;
  taskId?: string;
  turnId?: string;
  runAttemptId?: string;
  providerSessionId?: string;
  operationId?: string;
  artifactId?: string;
  remoteReceiptId?: string;
}

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newRequestCorrelation(requestId?: string): CorrelationChain {
  return { requestId: requestId ?? newId() };
}

export function withTask(
  chain: CorrelationChain,
  taskId: string,
): CorrelationChain {
  return { ...chain, taskId };
}

export function withRunAttempt(
  chain: CorrelationChain,
  runAttemptId: string,
): CorrelationChain {
  return { ...chain, runAttemptId };
}

export function withOperation(
  chain: CorrelationChain,
  operationId: string,
): CorrelationChain {
  return { ...chain, operationId };
}

/** Compact log-safe summary (no PII/secrets). */
export function correlationLogFields(
  chain: CorrelationChain,
): Record<string, string> {
  const out: Record<string, string> = { requestId: chain.requestId };
  if (chain.uiActionId) out.uiActionId = chain.uiActionId;
  if (chain.taskId) out.taskId = chain.taskId;
  if (chain.turnId) out.turnId = chain.turnId;
  if (chain.runAttemptId) out.runAttemptId = chain.runAttemptId;
  if (chain.providerSessionId) out.providerSessionId = chain.providerSessionId;
  if (chain.operationId) out.operationId = chain.operationId;
  if (chain.artifactId) out.artifactId = chain.artifactId;
  if (chain.remoteReceiptId) out.remoteReceiptId = chain.remoteReceiptId;
  return out;
}
