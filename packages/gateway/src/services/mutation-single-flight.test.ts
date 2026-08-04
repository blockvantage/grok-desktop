import { describe, expect, it, vi } from "vitest";
import { MutationSingleFlight } from "./mutation-receipts.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const key = {
  principalId: "desktop",
  method: "tasks.create",
  clientMutationId: "queue-item-1",
};

describe("MutationSingleFlight", () => {
  it("shares one in-flight dispatch for the same mutation and payload", async () => {
    const flights = new MutationSingleFlight();
    const pending = deferred<{ id: string }>();
    const persistReceipt = vi.fn();
    const dispatch = vi.fn(async () => {
      const result = await pending.promise;
      persistReceipt(result);
      return result;
    });
    const params = {
      goal: "same payload",
      clientMutationId: key.clientMutationId,
    };

    const first = flights.run(key, params, dispatch);
    const duplicate = flights.run(key, { ...params }, dispatch);
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);

    pending.resolve({ id: "task-1" });
    await expect(first).resolves.toEqual({ id: "task-1" });
    await expect(duplicate).resolves.toEqual({ id: "task-1" });
    expect(persistReceipt).toHaveBeenCalledOnce();
  });

  it("conflicts immediately when the same pending id has a different payload", async () => {
    const flights = new MutationSingleFlight();
    const pending = deferred<{ id: string }>();
    const dispatch = vi.fn(() => pending.promise);
    const first = flights.run(
      key,
      { goal: "first", clientMutationId: key.clientMutationId },
      dispatch,
    );

    await expect(
      flights.run(
        key,
        { goal: "different", clientMutationId: key.clientMutationId },
        dispatch,
      ),
    ).rejects.toThrow("clientMutationId reused with different payload");
    expect(dispatch).toHaveBeenCalledTimes(1);

    pending.resolve({ id: "task-1" });
    await first;
  });

  it("dedupes task.interject by clientMutationId like other mutations", async () => {
    const flights = new MutationSingleFlight();
    const interjectKey = {
      principalId: "desktop",
      method: "task.interject",
      clientMutationId: "q-interject-reload",
    };
    const pending = deferred<{ delivered: boolean; clientMutationId: string }>();
    const dispatch = vi.fn(async () => pending.promise);
    const params = {
      taskId: "t1",
      text: "mid-run aside",
      clientMutationId: interjectKey.clientMutationId,
    };

    const first = flights.run(interjectKey, params, dispatch);
    // Simulated reload replay of the same queued interjection.
    const replay = flights.run(interjectKey, { ...params }, dispatch);
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);

    pending.resolve({
      delivered: true,
      clientMutationId: interjectKey.clientMutationId,
    });
    await expect(first).resolves.toEqual({
      delivered: true,
      clientMutationId: "q-interject-reload",
    });
    await expect(replay).resolves.toEqual({
      delivered: true,
      clientMutationId: "q-interject-reload",
    });
  });

  it("clears a failed single-flight so a later retry can dispatch", async () => {
    const flights = new MutationSingleFlight();
    const dispatch = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(new Error("gateway unavailable"))
      .mockResolvedValueOnce({ id: "task-after-retry" });
    const params = {
      goal: "retry payload",
      clientMutationId: key.clientMutationId,
    };

    await expect(flights.run(key, params, dispatch)).rejects.toThrow(
      "gateway unavailable",
    );
    await expect(flights.run(key, params, dispatch)).resolves.toEqual({
      id: "task-after-retry",
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
