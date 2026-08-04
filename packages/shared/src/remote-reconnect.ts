/**
 * Pure reconnect / connection chrome state machine for mobile remote client.
 */

export type ConnectionState = "online" | "reconnecting" | "offline";

export type ConnectionEvent =
  | { type: "connect_start" }
  | { type: "connect_ok" }
  | { type: "connect_fail"; error?: string }
  | { type: "disconnect" }
  | { type: "give_up" }
  | { type: "manual_offline" }
  /** Permanent offline-queue flush failure while still online. */
  | { type: "queue_flush_error"; error: string }
  | { type: "queue_flush_ok" };

export type ConnectionModel = {
  state: ConnectionState;
  /** Consecutive failed connect attempts (reset on connect_ok). */
  attempt: number;
  lastError: string | null;
  /** Last offline-queue flush error (null when clean). */
  queueError: string | null;
  /** Label for UI chrome. */
  label: string;
};

export function initialConnectionModel(): ConnectionModel {
  return {
    state: "offline",
    attempt: 0,
    lastError: null,
    queueError: null,
    label: "Offline",
  };
}

export function reduceConnection(
  model: ConnectionModel,
  event: ConnectionEvent,
): ConnectionModel {
  switch (event.type) {
    case "connect_start":
      return {
        ...model,
        state: "reconnecting",
        label: model.attempt > 0 ? `Reconnecting… (${model.attempt + 1})` : "Connecting…",
      };
    case "connect_ok":
      // Always clear prior queue chrome on a successful wire-up; callers apply
      // queue_flush_error after flush if this reconnect's flush failed.
      return {
        state: "online",
        attempt: 0,
        lastError: null,
        queueError: null,
        label: "Online",
      };
    case "connect_fail": {
      const attempt = model.attempt + 1;
      const err = event.error ?? model.lastError;
      return {
        state: "reconnecting",
        attempt,
        lastError: err,
        queueError: model.queueError,
        label: err ? `Reconnecting… ${err}` : `Reconnecting… (${attempt})`,
      };
    }
    case "disconnect":
      return {
        ...model,
        state: "reconnecting",
        label: "Reconnecting…",
      };
    case "give_up":
    case "manual_offline":
      return {
        state: "offline",
        attempt: model.attempt,
        lastError: event.type === "give_up" ? model.lastError : null,
        queueError: model.queueError,
        label: model.lastError ? `Offline: ${model.lastError}` : "Offline",
      };
    case "queue_flush_error":
      return {
        ...model,
        queueError: event.error,
        label:
          model.state === "online"
            ? `Online — queue: ${event.error}`
            : model.label,
      };
    case "queue_flush_ok":
      return {
        ...model,
        queueError: null,
        label: model.state === "online" ? "Online" : model.label,
      };
    default:
      return model;
  }
}

/**
 * Exponential backoff with cap + ±25% jitter (CX-9).
 * attempt is 0-based after first failure.
 * attempt 0 → baseMs, 1 → 2*base, … capped at maxMs, then jittered.
 */
export function nextBackoffMs(
  attempt: number,
  opts?: { baseMs?: number; maxMs?: number; jitter?: number; random?: () => number },
): number {
  const base = opts?.baseMs ?? 500;
  const max = opts?.maxMs ?? 30_000;
  const jitterFrac = opts?.jitter ?? 0.25;
  const rand = opts?.random ?? Math.random;
  const n = Math.max(0, Math.floor(attempt));
  const raw = Math.min(max, base * Math.pow(2, n));
  if (jitterFrac <= 0) return raw;
  const span = raw * jitterFrac;
  return Math.max(0, Math.round(raw - span + rand() * 2 * span));
}

/**
 * Whether auto-reconnect should still try.
 * CX-9: while the app is foreground, never give up (hold at max interval).
 * Pass a finite maxAttempts only for tests / backgrounded-forever clients.
 */
export function shouldKeepReconnecting(
  attempt: number,
  maxAttempts: number = Number.POSITIVE_INFINITY,
): boolean {
  return attempt < maxAttempts;
}
