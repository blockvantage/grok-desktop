import { describe, expect, it, vi } from "vitest";
import {
  computeJitteredDelay,
  createUpdateScheduler,
  DEFAULT_CHECK_INTERVAL_MS,
} from "./update-scheduler.js";

describe("computeJitteredDelay", () => {
  it("stays within ±10% of the base interval", () => {
    const base = DEFAULT_CHECK_INTERVAL_MS;
    for (let i = 0; i < 20; i++) {
      const d = computeJitteredDelay(base, 0.1, () => i / 20);
      expect(d).toBeGreaterThanOrEqual(Math.floor(base * 0.9));
      expect(d).toBeLessThanOrEqual(Math.ceil(base * 1.1));
    }
  });

  it("is deterministic for a fixed RNG", () => {
    expect(computeJitteredDelay(10_000, 0.1, () => 0.5)).toBe(10_000);
  });
});

describe("createUpdateScheduler", () => {
  it("runs recover + check on start and schedules next fire with jitter", async () => {
    const recoverOnStartup = vi.fn(async () => ({
      ok: true as const,
      phase: "idle" as const,
      status: {} as never,
      notes: [],
    }));
    const checkAndStage = vi.fn(async () => ({
      ok: true as const,
      phase: "idle" as const,
      status: {} as never,
      notes: [],
    }));
    const tryInstallWhenIdle = vi.fn(async () => ({
      ok: true as const,
      phase: "idle" as const,
      status: {} as never,
      notes: [],
    }));

    const timers: Array<{ ms: number; fn: () => void }> = [];
    const scheduler = createUpdateScheduler({
      coordinator: { recoverOnStartup, checkAndStage, tryInstallWhenIdle },
      intervalMs: 60_000,
      jitterFraction: 0,
      random: () => 0.5,
      setTimeoutFn: ((fn: () => void, ms: number) => {
        timers.push({ ms, fn: fn as () => void });
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
      now: () => 1_000_000,
    });

    await scheduler.start();
    expect(recoverOnStartup).toHaveBeenCalledTimes(1);
    expect(checkAndStage).toHaveBeenCalledTimes(1);
    expect(scheduler.lastReason()).toBe("startup");
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(60_000);
    expect(scheduler.nextFireAt()).toBe(1_000_000 + 60_000);

    scheduler.stop();
    expect(scheduler.nextFireAt()).toBeNull();
  });

  it("single-flights concurrent checkNow / revocation", async () => {
    let inflight = 0;
    let maxInflight = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const checkAndStage = vi.fn(async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await gate;
      inflight -= 1;
      return {
        ok: true as const,
        phase: "idle" as const,
        status: {} as never,
        notes: [],
      };
    });
    const tryInstallWhenIdle = vi.fn(async () => ({
      ok: true as const,
      phase: "idle" as const,
      status: {} as never,
      notes: [],
    }));
    const recoverOnStartup = vi.fn(async () => ({
      ok: true as const,
      phase: "idle" as const,
      status: {} as never,
      notes: [],
    }));

    const scheduler = createUpdateScheduler({
      coordinator: { recoverOnStartup, checkAndStage, tryInstallWhenIdle },
      intervalMs: 60_000,
      setTimeoutFn: ((() => 0) as unknown) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    });

    const a = scheduler.checkNow("manual");
    const b = scheduler.onRevocation();
    // Both queued; only one check body at a time.
    await Promise.resolve();
    expect(maxInflight).toBeLessThanOrEqual(1);
    release();
    await Promise.all([a, b]);
    expect(checkAndStage).toHaveBeenCalledTimes(2);
    expect(maxInflight).toBe(1);
    expect(scheduler.lastReason()).toBe("revocation");
  });

  it("fires immediate check on revocation with reason", async () => {
    const checkAndStage = vi.fn(async () => ({
      ok: true as const,
      phase: "idle" as const,
      status: {} as never,
      notes: [],
    }));
    const tryInstallWhenIdle = vi.fn(async () => ({
      ok: true as const,
      phase: "idle" as const,
      status: {} as never,
      notes: [],
    }));
    const recoverOnStartup = vi.fn(async () => ({
      ok: true as const,
      phase: "idle" as const,
      status: {} as never,
      notes: [],
    }));
    const scheduler = createUpdateScheduler({
      coordinator: { recoverOnStartup, checkAndStage, tryInstallWhenIdle },
      setTimeoutFn: ((() => 0) as unknown) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    });
    await scheduler.onRevocation();
    expect(checkAndStage).toHaveBeenCalledTimes(1);
    expect(tryInstallWhenIdle).toHaveBeenCalled();
    expect(scheduler.lastReason()).toBe("revocation");
  });
});
