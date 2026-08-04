/**
 * Server-initiated frames from the gateway child over stdio (no JSON-RPC id).
 * Main process fans these out to the renderer like desktop.onStatus.
 */

export const GATEWAY_NOTIFY_METHODS = [
  "notify.tasksChanged",
  "notify.taskEvents",
  "notify.inboxChanged",
  "notify.remoteChanged",
  /** CX-12: phone tried to pair with expired/reused QR. */
  "notify.pairAttemptFailed",
  /** Follow-up outbox changed (ids/state only — no message text). */
  "notify.outboxChanged",
  /** Content-free delivery lifecycle metric for diagnostics. */
  "notify.deliveryMetric",
] as const;

export type GatewayNotifyMethod = (typeof GATEWAY_NOTIFY_METHODS)[number];

export type GatewayNotifyParams = {
  "notify.tasksChanged": Record<string, never>;
  "notify.taskEvents": { taskId: string; seq?: number };
  "notify.inboxChanged": Record<string, never>;
  "notify.remoteChanged": Record<string, never>;
  "notify.pairAttemptFailed": {
    reason: "expired" | "invalid" | "unknown";
  };
  "notify.outboxChanged": {
    conversationId?: string;
    itemIds?: string[];
    reason?: string;
  };
  "notify.deliveryMetric": {
    name: string;
    conversationId?: string;
    itemId?: string;
    status?: string;
    attemptCount?: number;
    durationMs?: number;
    outcome?: string;
  };
};

export type GatewayNotifyMessage<M extends GatewayNotifyMethod = GatewayNotifyMethod> =
  {
    type: "notify";
    method: M;
    params: GatewayNotifyParams[M];
  };

export function isGatewayNotifyMethod(
  value: string,
): value is GatewayNotifyMethod {
  return (GATEWAY_NOTIFY_METHODS as readonly string[]).includes(value);
}
