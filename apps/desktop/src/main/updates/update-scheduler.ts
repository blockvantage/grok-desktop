/**
 * Schedule synchronized Desk/Grok update checks.
 *
 * - After entitlement/runtime bootstrap at startup
 * - Every six hours with ±10% jitter
 * - Manually
 * - Immediately on active revocation
 *
 * Honors single-flight: one check/download/install transaction at a time.
 * Manifest ETag/cache is owned by ManifestClient; this module only schedules.
 */
import type { UpdateCoordinator } from "./update-coordinator.js";

export const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
export const DEFAULT_JITTER_FRACTION = 0.1; // ±10%

export type UpdateSchedulerOptions = {
  coordinator: Pick<
    UpdateCoordinator,
    "checkAndStage" | "tryInstallWhenIdle" | "recoverOnStartup"
  >;
  /** Base interval between automatic checks (default 6h). */
  intervalMs?: number;
  /** Jitter fraction applied to interval (default 0.1 → ±10%). */
  jitterFraction?: number;
  /** Injectable RNG in [0, 1). */
  random?: () => number;
  /** Injectable timers for tests. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  now?: () => number;
  onError?: (err: unknown, context: string) => void;
};

export type UpdateScheduler = {
  /** Run recovery + first check (bootstrap). */
  start: () => Promise<void>;
  stop: () => void;
  /** Manual check (single-flight with automatic checks). */
  checkNow: (reason?: string) => Promise<void>;
  /** Immediate check after signed revocation / security event. */
  onRevocation: () => Promise<void>;
  /** True while a check/stage transaction is running. */
  isRunning: () => boolean;
  /** Last successful schedule reason. */
  lastReason: () => string | null;
  /** Next scheduled fire time (ms since epoch), or null when stopped. */
  nextFireAt: () => number | null;
};

/**
 * Compute next delay with symmetric jitter: interval * (1 ± jitterFraction).
 */
export function computeJitteredDelay(
  intervalMs: number,
  jitterFraction: number,
  random: () => number = Math.random,
): number {
  const j = Math.min(Math.max(jitterFraction, 0), 0.5);
  // random in [-j, +j]
  const factor = 1 + (random() * 2 - 1) * j;
  return Math.max(1_000, Math.floor(intervalMs * factor));
}

export function createUpdateScheduler(
  options: UpdateSchedulerOptions,
): UpdateScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  const jitterFraction = options.jitterFraction ?? DEFAULT_JITTER_FRACTION;
  const random = options.random ?? Math.random;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const now = options.now ?? Date.now;
  const onError =
    options.onError ??
    ((err: unknown, ctx: string) => {
      console.error(`[update-scheduler] ${ctx}`, err);
    });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = true;
  let lastReason: string | null = null;
  let nextFireAt: number | null = null;
  /** Serialize check/download/install — one transaction at a time. */
  let chain: Promise<void> = Promise.resolve();

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    nextFireAt = null;
  }

  function scheduleNext(): void {
    if (stopped) return;
    clearTimer();
    const delay = computeJitteredDelay(intervalMs, jitterFraction, random);
    nextFireAt = now() + delay;
    timer = setTimeoutFn(() => {
      void runCheck("interval");
    }, delay);
    // Allow Node to exit in tests / non-daemon contexts.
    (timer as { unref?: () => void } | null)?.unref?.();
  }

  async function runCheck(reason: string): Promise<void> {
    // Enqueue behind any in-flight transaction (single-flight chain).
    const job = chain.then(async () => {
      if (stopped && reason === "interval") return;
      running = true;
      lastReason = reason;
      try {
        // Drain waiting_for_idle installs first when possible.
        await options.coordinator.tryInstallWhenIdle([`scheduler:${reason}`]);
        await options.coordinator.checkAndStage();
      } catch (err) {
        onError(err, reason);
      } finally {
        running = false;
        if (!stopped && reason !== "stop") {
          scheduleNext();
        }
      }
    });
    // Prevent unhandled rejection on the chain.
    chain = job.catch(() => undefined);
    await job;
  }

  return {
    async start() {
      stopped = false;
      lastReason = "startup";
      running = true;
      try {
        await options.coordinator.recoverOnStartup();
        await options.coordinator.checkAndStage();
      } catch (err) {
        onError(err, "startup");
      } finally {
        running = false;
        scheduleNext();
      }
    },

    stop() {
      stopped = true;
      clearTimer();
    },

    async checkNow(reason = "manual") {
      await runCheck(reason);
    },

    async onRevocation() {
      await runCheck("revocation");
    },

    isRunning() {
      return running;
    },

    lastReason() {
      return lastReason;
    },

    nextFireAt() {
      return nextFireAt;
    },
  };
}
