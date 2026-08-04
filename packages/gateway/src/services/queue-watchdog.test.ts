import { afterEach, describe, expect, it, vi } from "vitest";
import { startQueueWatchdog } from "./queue-watchdog.js";

describe("startQueueWatchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pumps immediately and periodically until stopped", async () => {
    vi.useFakeTimers();
    const pumpQueue = vi.fn(async () => {});
    const watchdog = startQueueWatchdog({ pumpQueue, intervalMs: 1_000 });

    await Promise.resolve();
    expect(pumpQueue).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(pumpQueue).toHaveBeenCalledTimes(3);

    watchdog.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pumpQueue).toHaveBeenCalledTimes(3);
  });

  it("reports a transient pump failure and keeps watching", async () => {
    vi.useFakeTimers();
    const error = new Error("temporary queue failure");
    const pumpQueue = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const watchdog = startQueueWatchdog({
      pumpQueue,
      onError,
      intervalMs: 1_000,
    });

    await vi.runAllTicks();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(pumpQueue).toHaveBeenCalledTimes(2);
    watchdog.stop();
  });

  it("does not overlap pumps while a previous recovery read is pending", async () => {
    vi.useFakeTimers();
    let finishFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const pumpQueue = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(first)
      .mockResolvedValue(undefined);
    const watchdog = startQueueWatchdog({ pumpQueue, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(pumpQueue).toHaveBeenCalledTimes(1);

    finishFirst();
    await first;
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pumpQueue).toHaveBeenCalledTimes(2);
    watchdog.stop();
  });

  it("waits for an active pump to settle and suppresses post-stop errors", async () => {
    vi.useFakeTimers();
    let rejectPump!: (error: Error) => void;
    const pendingPump = new Promise<void>((_resolve, reject) => {
      rejectPump = reject;
    });
    const pumpQueue = vi.fn(() => pendingPump);
    const onError = vi.fn();
    const watchdog = startQueueWatchdog({
      pumpQueue,
      onError,
      intervalMs: 1_000,
    });

    const stopping = watchdog.stop();
    expect(stopping).toBeInstanceOf(Promise);
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    rejectPump(new Error("late pump failure"));
    await stopping;
    expect(stopped).toBe(true);
    expect(onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(pumpQueue).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
