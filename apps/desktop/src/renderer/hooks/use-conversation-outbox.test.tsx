import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConversationOutbox } from "./use-conversation-outbox";

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
    const internals = (
      React as unknown as {
        __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
          ReactCurrentDispatcher: { current: unknown };
        };
      }
    ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    const previous = internals.ReactCurrentDispatcher.current;
    internals.ReactCurrentDispatcher.current = dispatcher;
    try {
      result = renderHook();
    } finally {
      internals.ReactCurrentDispatcher.current = previous;
    }
  }

  return {
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

describe("useConversationOutbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function installRpc(handlers: Record<string, (params: unknown) => unknown>) {
    const notifyListeners: Array<
      (msg: { method: string; params: Record<string, unknown> }) => void
    > = [];
    vi.stubGlobal("window", {
      grokdesk: {
        request: async (payload: {
          method: string;
          params: Record<string, unknown>;
        }) => {
          const h = handlers[payload.method];
          if (!h) return { ok: false, error: `no handler ${payload.method}` };
          return { ok: true, result: h(payload.params) };
        },
        onGatewayNotify: (
          cb: (msg: {
            method: string;
            params: Record<string, unknown>;
          }) => void,
        ) => {
          notifyListeners.push(cb);
          return () => {
            const i = notifyListeners.indexOf(cb);
            if (i >= 0) notifyListeners.splice(i, 1);
          };
        },
      },
    });
    return {
      notify(msg: { method: string; params: Record<string, unknown> }) {
        for (const l of notifyListeners) l(msg);
      },
    };
  }

  it("lists, enqueues with stable id, and clears only after accepted", async () => {
    const store: Array<Record<string, unknown>> = [];
    installRpc({
      "outbox.list": () => store,
      "outbox.enqueue": (params) => {
        const p = params as Record<string, unknown>;
        const item = {
          id: p.id,
          conversationId: p.conversationId,
          parentTaskId: p.parentTaskId,
          text: p.text,
          attachments: [],
          status: "pending",
          position: store.length + 1,
          acceptedTaskId: null,
          attemptCount: 0,
          failReason: null,
          createdAt: "2026-08-03T00:00:00.000Z",
          updatedAt: "2026-08-03T00:00:00.000Z",
        };
        store.push(item);
        return { outcome: "accepted", item };
      },
    });

    const harness = createHookHarness(() =>
      useConversationOutbox({
        conversationId: "c1",
        parentTaskId: "t1",
        isTerminal: false,
        gatewayReady: true,
      }),
    );
    harness.flush();
    await Promise.resolve();
    harness.flush();

    const outcome = await harness
      .flush()
      .enqueueAsync("hello", undefined, "mut-1");
    expect(outcome.outcome).toBe("accepted");
    if (outcome.outcome === "accepted") {
      expect(outcome.item.clientMutationId).toBe("mut-1");
    }
    await Promise.resolve();
    harness.flush();
    expect(harness.flush().messageQueue.map((m) => m.id)).toEqual(["mut-1"]);
    harness.unmount();
  });

  it("keeps draft path on full (does not throw)", async () => {
    installRpc({
      "outbox.list": () => [],
      "outbox.enqueue": () => ({ outcome: "full", limit: 200 }),
    });
    const harness = createHookHarness(() =>
      useConversationOutbox({
        conversationId: "c1",
        parentTaskId: "t1",
        isTerminal: false,
        gatewayReady: true,
      }),
    );
    harness.flush();
    const outcome = await harness.flush().enqueueAsync("overflow");
    expect(outcome).toEqual({ outcome: "full", limit: 200 });
    expect(harness.flush().messageQueue).toHaveLength(0);
    harness.unmount();
  });

  it("sendNow unsupported keeps item queued", async () => {
    const item = {
      id: "m1",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "nudge",
      attachments: [],
      status: "pending",
      position: 1,
      acceptedTaskId: null,
      attemptCount: 0,
      failReason: null,
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
    };
    installRpc({
      "outbox.list": () => [item],
      "outbox.sendNow": () => ({
        delivered: false,
        reason: "unsupported",
        item,
      }),
    });
    const harness = createHookHarness(() =>
      useConversationOutbox({
        conversationId: "c1",
        parentTaskId: "t1",
        taskId: "t1",
        isTerminal: false,
        gatewayReady: true,
      }),
    );
    harness.flush();
    await Promise.resolve();
    await Promise.resolve();
    harness.flush();
    const ctrl = harness.flush();
    expect(ctrl.messageQueue).toHaveLength(1);
    const row = ctrl.messageQueue[0]!;
    const delivered = await ctrl.interjectNow(row);
    expect(delivered).toBe(false);
    expect(harness.flush().messageQueue).toHaveLength(1);
    expect(harness.flush().sendNowSupported).toBe(false);
    harness.unmount();
  });

  it("disables send-now from outbox.summary when the engine has no interject", async () => {
    installRpc({
      "outbox.list": () => [],
      "outbox.summary": () => ({
        total: 0,
        byStatus: {},
        oldestPendingAgeMs: null,
        sendNowSupported: false,
      }),
    });
    const harness = createHookHarness(() =>
      useConversationOutbox({
        conversationId: "c1",
        parentTaskId: "t1",
        isTerminal: false,
        gatewayReady: true,
      }),
    );
    harness.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.flush().sendNowSupported).toBe(false);
    harness.unmount();
  });

  it("refresh on notify.outboxChanged for this conversation", async () => {
    let list: unknown[] = [];
    const bus = installRpc({
      "outbox.list": () => list,
    });
    const harness = createHookHarness(() =>
      useConversationOutbox({
        conversationId: "c1",
        parentTaskId: "t1",
        isTerminal: false,
        gatewayReady: true,
      }),
    );
    harness.flush();
    await Promise.resolve();
    await Promise.resolve();
    harness.flush();
    expect(harness.flush().messageQueue).toHaveLength(0);
    list = [
      {
        id: "n1",
        conversationId: "c1",
        parentTaskId: "t1",
        text: "via notify",
        attachments: [],
        status: "pending",
        position: 1,
        acceptedTaskId: null,
        attemptCount: 0,
        failReason: null,
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
      },
    ];
    bus.notify({
      method: "notify.outboxChanged",
      params: { conversationId: "c1", itemIds: ["n1"] },
    });
    await Promise.resolve();
    await Promise.resolve();
    harness.flush();
    expect(harness.flush().messageQueue.map((m) => m.id)).toEqual(["n1"]);
    harness.unmount();
  });
});
