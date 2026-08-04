import React from "react";
import type { Task, TaskEvent } from "@grokdesk/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatEvents } from "./use-chat-events";

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
    renderOnly() {
      render();
      return result!;
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

function task(id: string): Task {
  return {
    id,
    goal: `Goal ${id}`,
    title: null,
    mode: "interactive",
    status: "running",
    model: "grok",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: [],
      allowNetworkTools: true,
      allowShell: true,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    attachments: [],
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
    completedAt: null,
  };
}

function event(taskId: string): TaskEvent {
  return {
    id: `event-${taskId}`,
    taskId,
    seq: 1,
    kind: "message",
    payload: { role: "assistant", text: "Ready" },
    createdAt: "2026-07-16T12:00:01.000Z",
  };
}

async function drainPromises(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

/** Wrap legacy events.list array results into events.page shape. */
function asPage(events: TaskEvent[] = []) {
  const last = events[events.length - 1];
  return {
    events,
    nextAfterSeq: last?.seq ?? 0,
    hasMore: false,
  };
}

describe("useChatEvents", () => {
  it("hides an old same-chat snapshot immediately when a new turn is not yet authoritative", async () => {
    vi.useFakeTimers();
    let notify:
      | ((message: { method: string; params: Record<string, unknown> }) => void)
      | undefined;
    let turnBAvailable = false;
    const request = vi.fn(async (payload: unknown) => {
      const taskId = String(
        (payload as { params?: { taskId?: unknown } }).params?.taskId ?? "",
      );
      if (taskId === "turn-a") {
        return { ok: true as const, result: asPage([event("turn-a")]) };
      }
      if (taskId === "turn-b" && turnBAvailable) {
        return { ok: true as const, result: asPage([]) };
      }
      return { ok: false as const, error: "turn-b unavailable" };
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        grokdesk: {
          request,
          onGatewayNotify: (listener: typeof notify) => {
            notify = listener;
            return () => {};
          },
        },
      },
    });
    const turnA = task("turn-a");
    const turnB = task("turn-b");
    let selectedChatKey = "chat-a:turn-a";
    let turns = [turnA];
    const taskStatusRef = {
      current: new Map([
        [turnA.id, turnA.status],
        [turnB.id, turnB.status],
      ]),
    };
    const harness = createHookHarness(() =>
      useChatEvents({
        taskSurface: "workspace",
        selectedChatKey,
        chatId: "chat-a",
        turns,
        taskStatusRef,
      }),
    );

    harness.flush();
    await drainPromises();
    expect(harness.flush()).toMatchObject({
      loading: false,
      events: [expect.objectContaining({ id: "goal-turn-a" }), event("turn-a")],
    });

    turns = [turnA, turnB];
    selectedChatKey = "chat-a:turn-a:turn-b";
    expect(harness.renderOnly()).toMatchObject({ events: [], loading: true });

    harness.flush();
    await drainPromises();
    expect(harness.flush()).toMatchObject({ events: [], loading: true });

    turnBAvailable = true;
    notify?.({ method: "notify.taskEvents", params: { taskId: "turn-b" } });
    await drainPromises();
    expect(harness.flush()).toMatchObject({
      loading: false,
      events: [
        expect.objectContaining({ id: "goal-turn-a" }),
        event("turn-a"),
        expect.objectContaining({ id: "goal-turn-b" }),
      ],
    });
    harness.unmount();
  });

  it("stops rendering removed-turn events on the first same-chat rerender", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (payload: unknown) => {
      const taskId = String(
        (payload as { params?: { taskId?: unknown } }).params?.taskId ?? "",
      );
      return { ok: true as const, result: asPage([event(taskId)]) };
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        grokdesk: {
          request,
          onGatewayNotify: () => () => {},
        },
      },
    });
    const turnA = task("turn-a");
    const turnB = task("turn-b");
    let selectedChatKey = "chat-a:turn-a:turn-b";
    let turns = [turnA, turnB];
    const taskStatusRef = {
      current: new Map(turns.map((turn) => [turn.id, turn.status])),
    };
    const harness = createHookHarness(() =>
      useChatEvents({
        taskSurface: "workspace",
        selectedChatKey,
        chatId: "chat-a",
        turns,
        taskStatusRef,
      }),
    );

    harness.flush();
    await drainPromises();
    expect(harness.flush().events.map(({ id }) => id)).toEqual([
      "goal-turn-a",
      "event-turn-a",
      "goal-turn-b",
      "event-turn-b",
    ]);

    turns = [turnA];
    selectedChatKey = "chat-a:turn-a";
    const firstRender = harness.renderOnly();
    expect(firstRender.loading).toBe(false);
    expect(firstRender.events.map(({ id }) => id)).toEqual([
      "goal-turn-a",
      "event-turn-a",
    ]);
    expect(firstRender.eventsByTask).toEqual({
      "turn-a": [event("turn-a")],
    });
    harness.unmount();
  });

  it("keeps partially loaded cold history hidden until every turn is authoritative", async () => {
    vi.useFakeTimers();
    let notify:
      | ((message: { method: string; params: Record<string, unknown> }) => void)
      | undefined;
    let turnBAvailable = false;
    const request = vi.fn(async (payload: unknown) => {
      const taskId = String(
        (payload as { params?: { taskId?: unknown } }).params?.taskId ?? "",
      );
      if (taskId === "turn-a") {
        return { ok: true as const, result: asPage([event("turn-a")]) };
      }
      if (taskId === "turn-b" && turnBAvailable) {
        return { ok: true as const, result: asPage([]) };
      }
      return { ok: false as const, error: "turn-b unavailable" };
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        grokdesk: {
          request,
          onGatewayNotify: (listener: typeof notify) => {
            notify = listener;
            return () => {};
          },
        },
      },
    });
    const turns = [task("turn-a"), task("turn-b")];
    const taskStatusRef = {
      current: new Map(turns.map((turn) => [turn.id, turn.status])),
    };
    const harness = createHookHarness(() =>
      useChatEvents({
        taskSurface: "workspace",
        selectedChatKey: "chat-a:turn-a:turn-b",
        chatId: "chat-a",
        turns,
        taskStatusRef,
      }),
    );

    expect(harness.flush()).toMatchObject({ events: [], loading: true });
    await drainPromises();

    expect(request).toHaveBeenCalledTimes(2);
    expect(harness.flush()).toMatchObject({ events: [], loading: true });

    turnBAvailable = true;
    notify?.({ method: "notify.taskEvents", params: { taskId: "turn-b" } });
    await drainPromises();

    const loaded = harness.flush();
    expect(loaded.loading).toBe(false);
    expect(loaded.events.map(({ id }) => id)).toEqual([
      "goal-turn-a",
      "event-turn-a",
      "goal-turn-b",
    ]);
    expect(loaded.eventsByTask).toEqual({
      "turn-a": [event("turn-a")],
      "turn-b": [],
    });
    harness.unmount();
  });

  it("keeps a cold chat loading when every initial read fails, then accepts an empty retry", async () => {
    vi.useFakeTimers();
    let notify:
      | ((message: { method: string; params: Record<string, unknown> }) => void)
      | undefined;
    const request = vi.fn(async () => ({
      ok: false as const,
      error: "gateway unavailable",
    }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        grokdesk: {
          request,
          onGatewayNotify: (listener: typeof notify) => {
            notify = listener;
            return () => {};
          },
        },
      },
    });
    const turns = [task("turn-a"), task("turn-b")];
    const taskStatusRef = {
      current: new Map(turns.map((turn) => [turn.id, turn.status])),
    };
    const harness = createHookHarness(() =>
      useChatEvents({
        taskSurface: "workspace",
        selectedChatKey: "chat-a:turn-a:turn-b",
        chatId: "chat-a",
        turns,
        taskStatusRef,
      }),
    );

    expect(harness.flush().loading).toBe(true);
    await drainPromises();
    expect(request).toHaveBeenCalledTimes(2);
    expect(harness.flush()).toMatchObject({ events: [], loading: true });

    request.mockResolvedValue({
      ok: true as const,
      result: asPage([]),
    } as never);
    notify?.({ method: "notify.taskEvents", params: { taskId: "turn-a" } });
    await drainPromises();

    expect(harness.flush()).toMatchObject({ events: [], loading: true });

    notify?.({ method: "notify.taskEvents", params: { taskId: "turn-b" } });
    await drainPromises();

    expect(harness.flush()).toMatchObject({
      loading: false,
      events: [
        expect.objectContaining({ id: "goal-turn-a" }),
        expect.objectContaining({ id: "goal-turn-b" }),
      ],
    });
    harness.unmount();
  });

  it("keeps warm cached events visible when a refresh fails", async () => {
    vi.useFakeTimers();
    let notify:
      | ((message: { method: string; params: Record<string, unknown> }) => void)
      | undefined;
    const request = vi.fn(async () => ({
      ok: true as const,
      result: asPage([event("turn-a")]),
    }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        grokdesk: {
          request,
          onGatewayNotify: (listener: typeof notify) => {
            notify = listener;
            return () => {};
          },
        },
      },
    });
    const turn = task("turn-a");
    const taskStatusRef = {
      current: new Map([[turn.id, turn.status]]),
    };
    const harness = createHookHarness(() =>
      useChatEvents({
        taskSurface: "workspace",
        selectedChatKey: "chat-a:turn-a",
        chatId: "chat-a",
        turns: [turn],
        taskStatusRef,
      }),
    );

    harness.flush();
    await drainPromises();
    expect(harness.flush()).toMatchObject({
      loading: false,
      events: [expect.objectContaining({ id: "goal-turn-a" }), event("turn-a")],
    });

    request.mockResolvedValue({
      ok: false as const,
      error: "temporary refresh failure",
    } as never);
    notify?.({ method: "notify.taskEvents", params: { taskId: "turn-a" } });
    await drainPromises();

    expect(harness.flush()).toMatchObject({
      loading: false,
      events: [expect.objectContaining({ id: "goal-turn-a" }), event("turn-a")],
    });
    harness.unmount();
  });
});
