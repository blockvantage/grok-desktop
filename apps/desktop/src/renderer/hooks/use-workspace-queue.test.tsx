import React from "react";
import type { TaskAttachment } from "@grokdesk/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimDurable,
  emptyQueueStore,
  enqueueDurable,
  loadQueueStore,
  QUEUE_CLAIM_LEASE_MS,
  queueForConversation,
  saveQueueStore,
  type DurableQueuedMessage,
} from "@/lib/message-queue-store";
import {
  QUEUE_RECOVERY_VISIBLE_MS,
  useWorkspaceQueue,
} from "./use-workspace-queue";

type EffectSlot = {
  deps?: readonly unknown[];
  cleanup?: (() => void) | void;
};

function depsChanged(
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
): boolean {
  if (!previous || !next || previous.length !== next.length) return true;
  return previous.some((value, index) => !Object.is(value, next[index]));
}

function createHookHarness<T>(renderHook: () => T) {
  const slots: unknown[] = [];
  let cursor = 0;
  let dirty = true;
  let mounted = true;
  let result: T;
  let pendingEffects: Array<() => void> = [];

  const dispatcher = {
    useState<S>(initial: S | (() => S)) {
      const index = cursor++;
      if (!(index in slots)) {
        slots[index] =
          typeof initial === "function" ? (initial as () => S)() : initial;
      }
      const setState = (next: S | ((previous: S) => S)) => {
        if (!mounted) return;
        slots[index] =
          typeof next === "function"
            ? (next as (previous: S) => S)(slots[index] as S)
            : next;
        dirty = true;
      };
      return [slots[index] as S, setState] as const;
    },
    useRef<S>(initial: S) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: S };
    },
    useCallback<F>(callback: F, deps: readonly unknown[]) {
      const index = cursor++;
      const previous = slots[index] as
        | { callback: F; deps: readonly unknown[] }
        | undefined;
      if (!previous || depsChanged(previous.deps, deps)) {
        slots[index] = { callback, deps };
      }
      return (slots[index] as { callback: F }).callback;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++;
      const previous = slots[index] as EffectSlot | undefined;
      if (!previous || depsChanged(previous.deps, deps)) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: effect() } satisfies EffectSlot;
        });
      }
    },
  };

  function render() {
    cursor = 0;
    dirty = false;
    const internals = (React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: unknown };
      };
    }).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    const previous = internals.ReactCurrentDispatcher.current;
    internals.ReactCurrentDispatcher.current = dispatcher;
    try {
      result = renderHook();
    } finally {
      internals.ReactCurrentDispatcher.current = previous;
    }
  }

  return {
    rerender() {
      dirty = true;
      return this.flush();
    },
    flush() {
      do {
        if (dirty) render();
        const effects = pendingEffects;
        pendingEffects = [];
        effects.forEach((effect) => effect());
      } while (dirty || pendingEffects.length > 0);
      return result!;
    },
    unmount() {
      mounted = false;
      for (const slot of slots) {
        (slot as EffectSlot | undefined)?.cleanup?.();
      }
    },
  };
}

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
  } as Storage;
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

afterEach(() => {
  vi.useRealTimers();
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

describe("useWorkspaceQueue", () => {
  it("shows expired-lease recovery across a remount before one safe retry", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-07-15T12:00:00.000Z");
    vi.setSystemTime(new Date(now));
    const storage = memStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    let durable = enqueueDurable(
      emptyQueueStore(),
      "conversation-recovery",
      "retry once",
    );
    const queued = queueForConversation(durable, "conversation-recovery")[0]!;
    durable = claimDurable(
      durable,
      "conversation-recovery",
      queued.id,
      now - QUEUE_CLAIM_LEASE_MS,
    ).store;
    saveQueueStore(durable, storage);

    let resolveAcceptance!: (accepted: boolean) => void;
    const acceptance = new Promise<boolean>((resolve) => {
      resolveAcceptance = resolve;
    });
    const onFollowUp = vi.fn(
      (
        _goal: string,
        _attachments?: TaskAttachment[],
        _clientMutationId?: string,
      ) => acceptance,
    );
    const options = () => ({
      conversationId: "conversation-recovery",
      isTerminal: true,
      agentBusy: false,
      onFollowUp,
    });

    const first = createHookHarness(() => useWorkspaceQueue(options()));
    expect(first.flush().messageQueue[0]?.status).toBe("recovering");
    expect(onFollowUp).not.toHaveBeenCalled();
    expect(
      JSON.parse(storage.getItem("grokdesk.queue.v1")!).byConversation[
        "conversation-recovery"
      ][0].status,
    ).toBe("recovering");
    first.unmount();

    const remounted = createHookHarness(() => useWorkspaceQueue(options()));
    expect(remounted.flush().messageQueue[0]?.status).toBe("recovering");
    vi.advanceTimersByTime(QUEUE_RECOVERY_VISIBLE_MS - 1);
    remounted.flush();
    expect(onFollowUp).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(remounted.flush().messageQueue[0]?.status).toBe("submitting");
    expect(onFollowUp).toHaveBeenCalledTimes(1);
    expect(onFollowUp.mock.calls[0]?.[2]).toBe(queued.clientMutationId);

    remounted.unmount();
    const submittedRemount = createHookHarness(() =>
      useWorkspaceQueue(options()),
    );
    submittedRemount.flush();
    expect(onFollowUp).toHaveBeenCalledTimes(1);

    resolveAcceptance(true);
    await acceptance;
    await Promise.resolve();
    submittedRemount.flush();
    expect(
      queueForConversation(
        loadQueueStore(storage),
        "conversation-recovery",
      ),
    ).toHaveLength(0);
    submittedRemount.unmount();
  });

  it("submits one queued follow-up exactly once across a remount", async () => {
    const storage = memStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    let resolveAcceptance!: (accepted: boolean) => void;
    const acceptance = new Promise<boolean>((resolve) => {
      resolveAcceptance = resolve;
    });
    const onFollowUp = vi.fn(
      (
        _goal: string,
        _attachments?: TaskAttachment[],
        _clientMutationId?: string,
      ) => acceptance,
    );
    let isTerminal = false;
    const options = () => ({
      conversationId: "conversation-1",
      isTerminal,
      // Drain now keys off agentBusy (idle) instead of isTerminal; mirror the
      // old trigger so these timing tests keep their intent.
      agentBusy: !isTerminal,
      onFollowUp,
    });

    const first = createHookHarness(() => useWorkspaceQueue(options()));
    first.flush().enqueue("only once");
    first.flush();
    isTerminal = true;
    first.rerender();
    expect(onFollowUp).toHaveBeenCalledTimes(1);
    const clientMutationId = onFollowUp.mock.calls[0]?.[2];
    expect(clientMutationId).toMatch(/^q-/);

    first.unmount();
    const remounted = createHookHarness(() => useWorkspaceQueue(options()));
    remounted.flush();

    expect(onFollowUp).toHaveBeenCalledTimes(1);
    expect(onFollowUp.mock.calls[0]?.[2]).toBe(clientMutationId);
    resolveAcceptance(true);
    await acceptance;
    await Promise.resolve();
    expect(
      queueForConversation(loadQueueStore(storage), "conversation-1"),
    ).toHaveLength(0);
    remounted.flush();
    remounted.unmount();
  });

  it("does not reclaim after the old owner accepts while the remount stays mounted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    const storage = memStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    let resolveAcceptance!: (accepted: boolean) => void;
    const acceptance = new Promise<boolean>((resolve) => {
      resolveAcceptance = resolve;
    });
    const onFollowUp = vi.fn(() => acceptance);
    let isTerminal = false;
    const options = () => ({
      conversationId: "conversation-lease",
      isTerminal,
      // Drain now keys off agentBusy (idle) instead of isTerminal; mirror the
      // old trigger so these timing tests keep their intent.
      agentBusy: !isTerminal,
      onFollowUp,
    });

    const first = createHookHarness(() => useWorkspaceQueue(options()));
    first.flush().enqueue("lease once");
    first.flush();
    isTerminal = true;
    first.rerender();
    first.unmount();

    const remounted = createHookHarness(() => useWorkspaceQueue(options()));
    remounted.flush();
    resolveAcceptance(true);
    await acceptance;
    await Promise.resolve();
    expect(remounted.flush().messageQueue).toHaveLength(0);
    vi.advanceTimersByTime(QUEUE_CLAIM_LEASE_MS);
    remounted.flush();

    expect(onFollowUp).toHaveBeenCalledTimes(1);
    remounted.unmount();
  });

  it("preserves newer remounted queue changes when the old claim completes", async () => {
    const storage = memStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    let resolveAcceptance!: (accepted: boolean) => void;
    const acceptance = new Promise<boolean>((resolve) => {
      resolveAcceptance = resolve;
    });
    const onFollowUp = vi.fn(() => acceptance);
    let isTerminal = false;
    const options = () => ({
      conversationId: "conversation-merge",
      isTerminal,
      // Drain now keys off agentBusy (idle) instead of isTerminal; mirror the
      // old trigger so these timing tests keep their intent.
      agentBusy: !isTerminal,
      onFollowUp,
    });

    const first = createHookHarness(() => useWorkspaceQueue(options()));
    first.flush().enqueue("in flight");
    first.flush();
    isTerminal = true;
    first.rerender();
    first.unmount();

    isTerminal = false;
    const remounted = createHookHarness(() => useWorkspaceQueue(options()));
    remounted.flush().enqueue("newer message");
    let controller = remounted.flush();
    const newer = controller.messageQueue.find(
      (item) => item.text === "newer message",
    )!;
    controller.edit(newer.id, { text: "newer edit" });
    controller = remounted.flush();

    resolveAcceptance(true);
    await acceptance;
    await Promise.resolve();
    controller = remounted.flush();

    expect(
      queueForConversation(loadQueueStore(storage), "conversation-merge").map(
        (item) => item.text,
      ),
    ).toEqual(["newer edit"]);
    expect(controller.messageQueue.map((item) => item.text)).toEqual([
      "newer edit",
    ]);
    remounted.unmount();
  });

  it("atomically submits the edited text", () => {
    const storage = memStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    const onFollowUp = vi.fn().mockResolvedValue(true);
    const harness = createHookHarness(() =>
      useWorkspaceQueue({
        conversationId: "conversation-edit",
        isTerminal: false,
        // Agent still busy → no auto-drain; only the explicit editAndSendNow fires.
        agentBusy: true,
        onFollowUp,
      }),
    );
    harness.flush().enqueue("old text");
    const controller = harness.flush() as ReturnType<
      typeof useWorkspaceQueue
    > & {
      editAndSendNow: (
        item: DurableQueuedMessage,
        patch: { text?: string; attachmentPaths?: string[] },
      ) => void;
    };
    const item = controller.messageQueue[0]!;

    controller.editAndSendNow(item, { text: "edited text" });

    expect(onFollowUp).toHaveBeenCalledTimes(1);
    expect(onFollowUp.mock.calls[0]?.[0]).toBe("edited text");
    harness.unmount();
  });

  it("ignores a stale failure after a newer lease reclaims the item", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    const storage = memStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    let resolveFirst!: (accepted: boolean) => void;
    let resolveSecond!: (accepted: boolean) => void;
    const firstAcceptance = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    const secondAcceptance = new Promise<boolean>((resolve) => {
      resolveSecond = resolve;
    });
    const onFollowUp = vi
      .fn()
      .mockImplementationOnce(() => firstAcceptance)
      .mockImplementationOnce(() => secondAcceptance);
    let isTerminal = false;
    const options = () => ({
      conversationId: "conversation-stale-failure",
      isTerminal,
      // Drain now keys off agentBusy (idle) instead of isTerminal; mirror the
      // old trigger so these timing tests keep their intent.
      agentBusy: !isTerminal,
      onFollowUp,
    });

    const first = createHookHarness(() => useWorkspaceQueue(options()));
    first.flush().enqueue("lease race");
    first.flush();
    isTerminal = true;
    first.rerender();
    first.unmount();

    const remounted = createHookHarness(() => useWorkspaceQueue(options()));
    remounted.flush();
    vi.advanceTimersByTime(QUEUE_CLAIM_LEASE_MS);
    remounted.flush();
    expect(remounted.flush().messageQueue[0]?.status).toBe("recovering");
    expect(onFollowUp).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(QUEUE_RECOVERY_VISIBLE_MS);
    remounted.flush();
    expect(onFollowUp).toHaveBeenCalledTimes(2);

    resolveFirst(false);
    await firstAcceptance;
    await Promise.resolve();
    expect(remounted.flush().messageQueue[0]?.status).toBe("submitting");

    resolveSecond(true);
    await secondAcceptance;
    await Promise.resolve();
    remounted.flush();
    remounted.unmount();
  });

  it("ignores a stale success after a newer lease reclaims the item", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    const storage = memStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    let resolveFirst!: (accepted: boolean) => void;
    let resolveSecond!: (accepted: boolean) => void;
    const firstAcceptance = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    const secondAcceptance = new Promise<boolean>((resolve) => {
      resolveSecond = resolve;
    });
    const onFollowUp = vi
      .fn()
      .mockImplementationOnce(() => firstAcceptance)
      .mockImplementationOnce(() => secondAcceptance);
    let isTerminal = false;
    const options = () => ({
      conversationId: "conversation-stale-success",
      isTerminal,
      agentBusy: !isTerminal,
      onFollowUp,
    });

    const first = createHookHarness(() => useWorkspaceQueue(options()));
    first.flush().enqueue("lease race");
    first.flush();
    isTerminal = true;
    first.rerender();
    first.unmount();

    const remounted = createHookHarness(() => useWorkspaceQueue(options()));
    remounted.flush();
    vi.advanceTimersByTime(QUEUE_CLAIM_LEASE_MS);
    remounted.flush();
    expect(remounted.flush().messageQueue[0]?.status).toBe("recovering");
    vi.advanceTimersByTime(QUEUE_RECOVERY_VISIBLE_MS);
    remounted.flush();
    expect(onFollowUp).toHaveBeenCalledTimes(2);
    // Second lease now owns the item (submitting under a fresh claimedAt).
    expect(remounted.flush().messageQueue[0]?.status).toBe("submitting");

    // The STALE first send resolves "sent" late — it must NOT drop the row the
    // second lease owns. Only the current lease may complete the item.
    resolveFirst(true);
    await firstAcceptance;
    await Promise.resolve();
    expect(remounted.flush().messageQueue[0]?.status).toBe("submitting");

    // The live (second) lease completes and removes it exactly once.
    resolveSecond(true);
    await secondAcceptance;
    await Promise.resolve();
    expect(remounted.flush().messageQueue).toHaveLength(0);
    remounted.unmount();
  });

  it("guards a double interject: a second Send-now in flight is a no-op", async () => {
    const storage = memStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    let resolveInterject!: (r: { delivered: boolean }) => void;
    const interjection = new Promise<{ delivered: boolean }>((resolve) => {
      resolveInterject = resolve;
    });
    type InterjectFn = (
      taskId: string,
      text: string,
      clientMutationId: string,
    ) => Promise<{ delivered: boolean }>;
    const onInterject = vi.fn<InterjectFn>(() => interjection);
    const onFollowUp = vi.fn().mockResolvedValue(true);
    const harness = createHookHarness(() =>
      useWorkspaceQueue({
        conversationId: "conversation-interject",
        taskId: "task-live",
        isTerminal: false,
        agentBusy: true, // live turn → no auto-drain; only explicit Send-now
        onFollowUp,
        onInterject,
      }),
    );
    harness.flush().enqueue("interject me");
    const controller = harness.flush();
    const item = controller.messageQueue[0]!;

    // Two rapid clicks while the first interjection RPC is still in flight.
    void controller.interjectNow(item);
    const secondClick = controller.interjectNow(item);

    // RPC fired once; the item shows as interjecting (Send-now disabled).
    expect(onInterject).toHaveBeenCalledTimes(1);
    expect(onInterject.mock.calls[0]?.[2]).toBe(item.clientMutationId);
    expect(harness.flush().interjectingIds.has(item.id)).toBe(true);
    // The concurrent click was treated as already-handled (no claim fallback).
    expect(await secondClick).toBe(true);

    resolveInterject({ delivered: true });
    await interjection;
    await Promise.resolve();
    harness.flush();

    // Delivered exactly once → dropped from the queue; guard cleared.
    expect(onInterject).toHaveBeenCalledTimes(1);
    expect(onFollowUp).not.toHaveBeenCalled();
    expect(
      queueForConversation(loadQueueStore(storage), "conversation-interject"),
    ).toHaveLength(0);
    expect(harness.flush().interjectingIds.has(item.id)).toBe(false);
    harness.unmount();
  });

  it("passes clientMutationId on interject and keeps the item until delivered ack", async () => {
    const storage = memStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    let resolveInterject!: (r: { delivered: boolean }) => void;
    const interjection = new Promise<{ delivered: boolean }>((resolve) => {
      resolveInterject = resolve;
    });
    const onInterject = vi.fn(() => interjection);
    const harness = createHookHarness(() =>
      useWorkspaceQueue({
        conversationId: "conversation-interject-id",
        taskId: "task-live",
        isTerminal: false,
        agentBusy: true,
        onFollowUp: vi.fn().mockResolvedValue(true),
        onInterject,
      }),
    );
    harness.flush().enqueue("reload-safe aside");
    const item = harness.flush().messageQueue[0]!;
    expect(item.clientMutationId).toMatch(/^q-/);

    const pending = harness.flush().interjectNow(item);
    expect(onInterject).toHaveBeenCalledWith(
      "task-live",
      "reload-safe aside",
      item.clientMutationId,
    );
    // Not delivered yet — still in the durable queue.
    expect(
      queueForConversation(
        loadQueueStore(storage),
        "conversation-interject-id",
      ),
    ).toHaveLength(1);

    resolveInterject({ delivered: true });
    await expect(pending).resolves.toBe(true);
    await Promise.resolve();
    harness.flush();
    expect(
      queueForConversation(
        loadQueueStore(storage),
        "conversation-interject-id",
      ),
    ).toHaveLength(0);
    harness.unmount();
  });

  it("does not drop a queued interjection when delivered is false (replay-safe)", async () => {
    const storage = memStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    const onInterject = vi.fn(async () => ({ delivered: false }));
    const harness = createHookHarness(() =>
      useWorkspaceQueue({
        conversationId: "conversation-interject-fail",
        taskId: "task-live",
        isTerminal: false,
        agentBusy: true,
        onFollowUp: vi.fn().mockResolvedValue(true),
        onInterject,
      }),
    );
    harness.flush().enqueue("keep me");
    const item = harness.flush().messageQueue[0]!;
    await expect(harness.flush().interjectNow(item)).resolves.toBe(false);
    // Same mutation id remains queued for a later claim/retry.
    const remaining = queueForConversation(
      loadQueueStore(storage),
      "conversation-interject-fail",
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.clientMutationId).toBe(item.clientMutationId);
    harness.unmount();
  });

  it("replay after remount reuses the same clientMutationId (no duplicate message)", async () => {
    const storage = memStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    const mutationIds: string[] = [];
    const onInterject = vi.fn(
      async (
        _taskId: string,
        _text: string,
        clientMutationId: string,
      ) => {
        mutationIds.push(clientMutationId);
        return { delivered: true };
      },
    );

    const first = createHookHarness(() =>
      useWorkspaceQueue({
        conversationId: "conversation-interject-replay",
        taskId: "task-live",
        isTerminal: false,
        agentBusy: true,
        onFollowUp: vi.fn().mockResolvedValue(true),
        onInterject,
      }),
    );
    first.flush().enqueue("aside once");
    const item = first.flush().messageQueue[0]!;
    const originalMutationId = item.clientMutationId;
    first.unmount();

    // Simulate reload: same durable queue, new hook owner.
    const remounted = createHookHarness(() =>
      useWorkspaceQueue({
        conversationId: "conversation-interject-replay",
        taskId: "task-live",
        isTerminal: false,
        agentBusy: true,
        onFollowUp: vi.fn().mockResolvedValue(true),
        onInterject,
      }),
    );
    const recovered = remounted.flush().messageQueue[0]!;
    expect(recovered.clientMutationId).toBe(originalMutationId);
    await remounted.flush().interjectNow(recovered);
    await Promise.resolve();
    remounted.flush();
    expect(mutationIds).toEqual([originalMutationId]);
    expect(
      queueForConversation(
        loadQueueStore(storage),
        "conversation-interject-replay",
      ),
    ).toHaveLength(0);
    remounted.unmount();
  });
});
