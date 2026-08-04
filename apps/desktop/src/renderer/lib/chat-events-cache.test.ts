import { describe, it, expect } from "vitest";
import {
  afterSeqForTurn,
  chatCacheHasEvents,
  chatCacheIsWarm,
  createMultiChatEventsCache,
  getChatCache,
  markTurnLoaded,
  mergeTurnEvents,
  nextTurnSeq,
  selectOwnedChatEvents,
  serializeTurnLoad,
  touchChatCache,
} from "./chat-events-cache";
import type { TaskEvent } from "@grokdesk/shared";

function ev(
  id: string,
  overrides: Partial<TaskEvent> = {},
): TaskEvent {
  return {
    id,
    taskId: "t1",
    seq: 1,
    kind: "message",
    payload: { role: "assistant", text: "hi" },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("multi-chat events cache", () => {
  it("touches create warm entries and preserves per-turn data", () => {
    const cache = createMultiChatEventsCache(3);
    const a = touchChatCache(cache, "chat-a");
    a.perTurn.set("t1", [ev("e1")]);
    expect(chatCacheHasEvents(a)).toBe(true);

    const b = touchChatCache(cache, "chat-b");
    expect(chatCacheHasEvents(b)).toBe(false);

    const aAgain = touchChatCache(cache, "chat-a");
    expect(aAgain.perTurn.get("t1")?.[0]?.id).toBe("e1");
  });

  it("treats a successfully loaded empty chat as warm on return", () => {
    const entry = touchChatCache(createMultiChatEventsCache(), "chat-empty");
    expect(chatCacheHasEvents(entry)).toBe(false);
    expect(chatCacheIsWarm(entry)).toBe(false);

    markTurnLoaded(entry, "t-empty");

    expect(chatCacheHasEvents(entry)).toBe(false);
    expect(chatCacheIsWarm(entry)).toBe(true);
  });

  it("evicts least-recently used chats beyond max", () => {
    const cache = createMultiChatEventsCache(2);
    touchChatCache(cache, "a");
    touchChatCache(cache, "b");
    touchChatCache(cache, "c"); // evict a
    expect(getChatCache(cache, "a")).toBeUndefined();
    expect(getChatCache(cache, "b")).toBeDefined();
    expect(getChatCache(cache, "c")).toBeDefined();
  });

  it("LRU refresh keeps hot chat on eviction", () => {
    const cache = createMultiChatEventsCache(2);
    touchChatCache(cache, "a");
    touchChatCache(cache, "b");
    touchChatCache(cache, "a"); // a is hot again
    touchChatCache(cache, "c"); // should evict b, not a
    expect(getChatCache(cache, "a")).toBeDefined();
    expect(getChatCache(cache, "b")).toBeUndefined();
    expect(getChatCache(cache, "c")).toBeDefined();
  });

  it("merges one ordered copy of each event for the requested turn", () => {
    const existing = [ev("e1", { seq: 1 })];
    const merged = mergeTurnEvents(existing, [
      ev("duplicate-seq", { seq: 1 }),
      ev("wrong-task", { taskId: "t2", seq: 2 }),
      ev("e3", { seq: 3 }),
      ev("e2", { seq: 2 }),
      { ...ev("missing-id", { seq: 4 }), id: "" },
      { ...ev("missing-seq"), seq: Number.NaN },
    ], "t1");

    expect(merged.map((event) => event.id)).toEqual(["e1", "e2", "e3"]);
    expect(nextTurnSeq(merged)).toBe(3);
  });

  it("does not let a duplicate event id re-enter at another sequence", () => {
    const merged = mergeTurnEvents(
      [ev("same", { seq: 2 })],
      [ev("same", { seq: 3 })],
      "t1",
    );
    expect(merged).toHaveLength(1);
    expect(nextTurnSeq(merged)).toBe(2);
  });

  it("refreshes a coalesced event with the newest payload", () => {
    const firstChunk = ev("stream", {
      seq: 4,
      payload: { role: "assistant", text: "Hel" },
    });
    const complete = ev("stream", {
      seq: 4,
      payload: { role: "assistant", text: "Hello" },
    });

    const merged = mergeTurnEvents([firstChunk], [complete], "t1");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.payload.text).toBe("Hello");
    expect(afterSeqForTurn(merged)).toBe(3);
  });

  it("rejects invalid event kinds, payload arrays, and timestamps", () => {
    const merged = mergeTurnEvents(
      [],
      [
        ev("bad-kind", { kind: "unknown" as TaskEvent["kind"] }),
        ev("array-payload", {
          seq: 2,
          payload: [] as unknown as Record<string, unknown>,
        }),
        ev("bad-date", { seq: 3, createdAt: "not-a-date" }),
        ev("valid", { seq: 4 }),
      ],
      "t1",
    );
    expect(merged.map((event) => event.id)).toEqual(["valid"]);
  });

  it("preserves every authoritative worker lifecycle event", () => {
    const workerKinds: TaskEvent["kind"][] = [
      "worker_started",
      "worker_activity",
      "worker_message",
      "worker_completed",
      "worker_failed",
    ];
    const merged = mergeTurnEvents(
      [],
      workerKinds.map((kind, index) =>
        ev(`worker-${index}`, {
          seq: index + 1,
          kind,
          payload: { workerId: "worker-1" },
        }),
      ),
      "t1",
    );

    expect(merged.map((event) => event.kind)).toEqual(workerKinds);
  });

  it("runs one trailing load when another trigger arrives in flight", async () => {
    const entry = touchChatCache(createMultiChatEventsCache(), "chat-a");
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const loadOnce = async () => {
      calls += 1;
      if (calls === 1) await firstGate;
      return calls === 2;
    };

    const first = serializeTurnLoad(entry, "t1", loadOnce);
    const duringFlight = serializeTurnLoad(entry, "t1", loadOnce);
    expect(first).toBe(duringFlight);
    releaseFirst?.();

    await expect(first).resolves.toBe(true);
    expect(calls).toBe(2);
    expect(entry.inFlight.has("t1")).toBe(false);
  });

  it("still runs the requested trailing load after a transient rejection", async () => {
    const entry = touchChatCache(createMultiChatEventsCache(), "chat-a");
    let rejectFirst: ((error: Error) => void) | undefined;
    const firstGate = new Promise<never>((_resolve, reject) => {
      rejectFirst = reject;
    });
    let calls = 0;
    const loadOnce = async () => {
      calls += 1;
      if (calls === 1) return firstGate;
      return true;
    };

    const first = serializeTurnLoad(entry, "t1", loadOnce);
    const duringFlight = serializeTurnLoad(entry, "t1", loadOnce);
    rejectFirst?.(new Error("temporary RPC failure"));

    await expect(first).resolves.toBe(true);
    await expect(duringFlight).resolves.toBe(true);
    expect(calls).toBe(2);
    expect(entry.inFlight.has("t1")).toBe(false);
  });

  it("never exposes events owned by the previous chat", () => {
    const stale = {
      chatId: "chat-a",
      events: [ev("from-a")],
      loading: false,
    };
    const coldB = selectOwnedChatEvents(stale, "chat-b", null);
    expect(coldB).toEqual({ events: [], loading: true });

    const warmB = selectOwnedChatEvents(stale, "chat-b", [
      ev("from-b", { taskId: "t2" }),
    ]);
    expect(warmB.events.map((event) => event.id)).toEqual(["from-b"]);
    expect(warmB.loading).toBe(false);
  });
});
