/** Periodically re-pump durable queued tasks so a missed trigger self-heals. */

export type QueueWatchdogControl = {
  tick(): void;
  stop(): Promise<void>;
};

export function startQueueWatchdog(opts: {
  pumpQueue: () => void | Promise<void>;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}): QueueWatchdogControl {
  const intervalMs = Math.max(250, opts.intervalMs ?? 5_000);
  let stopped = false;
  let pumping = false;
  let activePump: Promise<void> | null = null;

  const report = (error: unknown) => {
    if (stopped) return;
    try {
      opts.onError?.(error);
    } catch {
      // Diagnostics must never stop queue recovery.
    }
  };

  const tick = () => {
    if (stopped || pumping) return;
    pumping = true;
    try {
      let pump: Promise<void>;
      pump = Promise.resolve(opts.pumpQueue())
        .catch(report)
        .finally(() => {
          pumping = false;
          if (activePump === pump) activePump = null;
        });
      activePump = pump;
    } catch (error) {
      pumping = false;
      report(error);
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  return {
    tick,
    async stop() {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
      }
      await activePump;
    },
  };
}
