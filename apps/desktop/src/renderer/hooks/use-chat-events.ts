/**
 * Aggregates per-turn events for the open chat into one stream.
 * Multi-chat LRU cache: return visits paint immediately; cold chats show loader.
 */

import { useEffect, useRef, useState } from "react";
import type { Task, TaskEvent } from "@grokdesk/shared";
import { rpc, subscribeGatewayNotify } from "@/lib/api";
import {
  afterSeqForTurn,
  createMultiChatEventsCache,
  getChatCache,
  mergeTurnEvents,
  markTurnLoaded,
  selectOwnedChatEvents,
  serializeTurnLoad,
  touchChatCache,
  type ChatTurnCache,
  type OwnedChatEvents,
} from "@/lib/chat-events-cache";
import {
  eventsByTaskForOwners,
  requestedChatLoading,
} from "@/lib/conversation-event-buckets";

export type ChatEventsState = {
  events: TaskEvent[];
  /** Authoritative cache buckets, keyed by the turn that fetched each event. */
  eventsByTask: Record<string, TaskEvent[]>;
  /** True while the first fetch for a cold (uncached) chat is in flight. */
  loading: boolean;
  /** Last fetch/list error message (cache still visible). */
  error: string | null;
  /** When cached data became stale after a failed refresh. */
  staleSince: string | null;
  /** True when paging hit the safety budget before full history. */
  truncated: boolean;
  /** Immediate retry of open conversation history. */
  retry: () => void;
};

type EventsPageResult = {
  events: TaskEvent[];
  nextAfterSeq: number;
  hasMore: boolean;
};

function sameEventState(a: TaskEvent[], b: TaskEvent[]): boolean {
  return (
    a.length === b.length &&
    a.every((event, index) => {
      const other = b[index];
      return (
        other?.id === event.id &&
        other.taskId === event.taskId &&
        other.seq === event.seq &&
        other.kind === event.kind &&
        other.createdAt === event.createdAt &&
        JSON.stringify(other.payload) === JSON.stringify(event.payload)
      );
    })
  );
}

/** Max pages per turn; beyond this we surface truncated rather than fake completeness. */
const EVENTS_PAGE_SAFETY_BUDGET = 40;
const EVENTS_PAGE_SIZE = 200;

export type LoadTurnResult = {
  changed: boolean;
  truncated: boolean;
  error: string | null;
};

/** Serialize all fetch paths for one turn via events.page cursor exhaustion. */
function loadTurn(entry: ChatTurnCache, taskId: string): Promise<LoadTurnResult> {
  return serializeTurnLoad(
    entry,
    taskId,
    async (): Promise<LoadTurnResult> => {
      let before = entry.perTurn.get(taskId) ?? [];
      const wasLoaded = entry.loadedTurns.has(taskId);
      let changed = false;
      let truncated = false;
      let error: string | null = null;
      try {
        for (let page = 0; page < EVENTS_PAGE_SAFETY_BUDGET; page++) {
          const result = await rpc<EventsPageResult>("events.page", {
            taskId,
            afterSeq: afterSeqForTurn(before),
            limit: EVENTS_PAGE_SIZE,
          });
          const batch = Array.isArray(result?.events) ? result.events : [];
          if (batch.length === 0) break;
          const merged = mergeTurnEvents(before, batch, taskId);
          if (!sameEventState(before, merged)) {
            changed = true;
            entry.perTurn.set(taskId, merged);
            before = merged;
          }
          if (!result.hasMore) break;
          if (page === EVENTS_PAGE_SAFETY_BUDGET - 1 && result.hasMore) {
            truncated = true;
          }
        }
        markTurnLoaded(entry, taskId);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        // Do not mark loaded on failure — leave stale/retryable.
      }
      return {
        changed: changed || (!wasLoaded && !error),
        truncated,
        error,
      };
    },
    (r) => r.changed,
    (acc, next) => ({
      changed: Boolean(acc?.changed || next.changed),
      truncated: Boolean(acc?.truncated || next.truncated),
      error: next.error ?? acc?.error ?? null,
    }),
  );
}

function rebuildCombined(
  turns: Task[],
  perTurn: Map<string, TaskEvent[]>,
): TaskEvent[] {
  const combined: TaskEvent[] = [];
  for (const turn of turns) {
    const evs = perTurn.get(turn.id) ?? [];
    const goalText = (turn.goal ?? "").trim();
    const hasUserGoal = evs.some((e) => {
      if (e.kind !== "message") return false;
      const p = e.payload ?? {};
      if (String(p.role ?? "") !== "user") return false;
      return String(p.text ?? "").trim() === goalText;
    });
    if (goalText && !hasUserGoal) {
      combined.push({
        id: `goal-${turn.id}`,
        taskId: turn.id,
        seq: 0,
        kind: "message",
        payload: { role: "user", text: turn.goal },
        createdAt: turn.createdAt,
      });
    }
    combined.push(...evs);
  }
  return combined;
}

function hasAuthoritativeHistory(
  entry: ChatTurnCache,
  turns: readonly Task[],
): boolean {
  return turns.every((turn) => entry.loadedTurns.has(turn.id));
}

export function useChatEvents(opts: {
  taskSurface: "list" | "workspace";
  selectedChatKey: string;
  chatId: string;
  turns: Task[];
  taskStatusRef: React.MutableRefObject<Map<string, string>>;
  /** Increment to force a full resync (e.g. gateway ready edge). */
  resyncKey?: number;
}): ChatEventsState {
  const [snapshot, setSnapshot] = useState<
    OwnedChatEvents & {
      selectedChatKey: string;
      eventsByTask: Record<string, TaskEvent[]>;
      error: string | null;
      staleSince: string | null;
      truncated: boolean;
    }
  >({
    chatId: "",
    selectedChatKey: "",
    events: [],
    eventsByTask: {},
    loading: false,
    error: null,
    staleSince: null,
    truncated: false,
  });
  const multiRef = useRef(createMultiChatEventsCache(24));
  const [retryTick, setRetryTick] = useState(0);
  const retry = () => setRetryTick((n) => n + 1);

  useEffect(() => {
    if (opts.taskSurface !== "workspace") {
      setSnapshot({
        chatId: "",
        selectedChatKey: "",
        events: [],
        eventsByTask: {},
        loading: false,
        error: null,
        staleSince: null,
        truncated: false,
      });
      return;
    }
    const chatId = opts.chatId;
    const selectedChatKey = opts.selectedChatKey;
    // selectedChatKey changes whenever this set changes. Capture it for the
    // lifetime of this subscription so another chat render cannot retarget it.
    const turns = opts.turns;
    if (!chatId || turns.length === 0) {
      setSnapshot({
        chatId,
        selectedChatKey,
        events: [],
        eventsByTask: {},
        loading: false,
        error: null,
        staleSince: null,
        truncated: false,
      });
      return;
    }

    let cancelled = false;
    const multi = multiRef.current;
    const entry = touchChatCache(multi, chatId);
    const { perTurn } = entry;
    const turnIds = new Set(turns.map((turn) => turn.id));
    const warm = hasAuthoritativeHistory(entry, turns);

    // Warm: paint cached events immediately (no empty flash, no logo wait).
    if (warm) {
      setSnapshot((prev) => ({
        chatId,
        selectedChatKey,
        events: rebuildCombined(turns, perTurn),
        eventsByTask: eventsByTaskForOwners(turns, perTurn),
        loading: false,
        error: prev.error,
        staleSince: prev.staleSince,
        truncated: prev.truncated,
      }));
    } else {
      setSnapshot({
        chatId,
        selectedChatKey,
        events: [],
        eventsByTask: {},
        loading: true,
        error: null,
        staleSince: null,
        truncated: false,
      });
    }

    const isTerminal = (id: string) => {
      const st = opts.taskStatusRef.current.get(id);
      return st === "done" || st === "failed" || st === "cancelled";
    };

    const rebuild = (meta?: {
      error?: string | null;
      staleSince?: string | null;
      truncated?: boolean;
    }) => {
      if (cancelled) return;
      setSnapshot((prev) => ({
        chatId,
        selectedChatKey,
        events: rebuildCombined(turns, perTurn),
        eventsByTask: eventsByTaskForOwners(turns, perTurn),
        loading: false,
        error: meta?.error !== undefined ? meta.error : prev.error,
        staleSince:
          meta?.staleSince !== undefined ? meta.staleSince : prev.staleSince,
        truncated:
          meta?.truncated !== undefined ? meta.truncated : prev.truncated,
      }));
    };

    void (async () => {
      const toFetch = turns.filter(
        (t) => !isTerminal(t.id) || !entry.loadedTurns.has(t.id),
      );
      const results = await Promise.all(
        toFetch.map((t) =>
          loadTurn(entry, t.id).catch(
            (e): LoadTurnResult => ({
              changed: false,
              truncated: false,
              error: e instanceof Error ? e.message : String(e),
            }),
          ),
        ),
      );
      if (cancelled) return;
      const anyError = results.find((r) => r.error)?.error ?? null;
      const anyTruncated = results.some((r) => r.truncated);
      if (anyError) {
        // Warm cache: keep events visible and mark stale for retry.
        // Cold cache: stay loading — never invent an authoritative empty history.
        if (warm || hasAuthoritativeHistory(entry, turns)) {
          rebuild({
            error: anyError,
            staleSince: new Date().toISOString(),
            truncated: anyTruncated,
          });
        } else {
          setSnapshot((prev) => ({
            ...prev,
            chatId,
            selectedChatKey,
            loading: true,
            error: anyError,
            staleSince: new Date().toISOString(),
            truncated: anyTruncated,
          }));
        }
        return;
      }
      if (hasAuthoritativeHistory(entry, turns)) {
        rebuild({ error: null, staleSince: null, truncated: anyTruncated });
      }
    })();

    const unsubNotify = subscribeGatewayNotify((msg) => {
      if (msg.method !== "notify.taskEvents") return;
      const taskId = String(msg.params.taskId ?? "");
      if (!taskId) return;
      if (!turnIds.has(taskId)) return;
      void loadTurn(entry, taskId)
        .then((result) => {
          if (cancelled) return;
          if (result.error) {
            rebuild({
              error: result.error,
              staleSince: new Date().toISOString(),
            });
            return;
          }
          if (result.changed && hasAuthoritativeHistory(entry, turns)) {
            rebuild({
              error: null,
              staleSince: null,
              truncated: result.truncated,
            });
          }
        })
        .catch(() => {});
    });

    const timer = setInterval(() => {
      void (async () => {
        let changed = false;
        let truncated = false;
        let error: string | null = null;
        for (const t of turns) {
          if (isTerminal(t.id) && entry.loadedTurns.has(t.id)) continue;
          const r = await loadTurn(entry, t.id).catch(
            (e): LoadTurnResult => ({
              changed: false,
              truncated: false,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
          if (r.changed) changed = true;
          if (r.truncated) truncated = true;
          if (r.error) error = r.error;
        }
        if (error) {
          rebuild({
            error,
            staleSince: new Date().toISOString(),
            truncated,
          });
          return;
        }
        if (changed && hasAuthoritativeHistory(entry, turns)) {
          rebuild({ error: null, staleSince: null, truncated });
        }
        // Do not permanently stop terminal polling until history is exhausted
        // successfully — a failed final read remains stale/retryable.
        if (
          turns.every((t) => isTerminal(t.id)) &&
          hasAuthoritativeHistory(entry, turns) &&
          !error
        ) {
          clearInterval(timer);
        }
      })();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubNotify();
    };
  }, [
    opts.selectedChatKey,
    opts.taskSurface,
    opts.chatId,
    opts.taskStatusRef,
    opts.resyncKey,
    retryTick,
  ]);

  if (
    opts.taskSurface !== "workspace" ||
    !opts.chatId ||
    opts.turns.length === 0
  ) {
    return {
      events: [],
      eventsByTask: {},
      loading: false,
      error: null,
      staleSince: null,
      truncated: false,
      retry,
    };
  }
  const cached = getChatCache(multiRef.current, opts.chatId);
  const cachedEvents =
    cached && hasAuthoritativeHistory(cached, opts.turns)
      ? rebuildCombined(opts.turns, cached.perTurn)
      : null;
  const ownsSelectedTurnSet =
    snapshot.chatId === opts.chatId &&
    snapshot.selectedChatKey === opts.selectedChatKey;
  const selected = selectOwnedChatEvents(
    ownsSelectedTurnSet ? snapshot : { ...snapshot, chatId: "" },
    opts.chatId,
    cachedEvents,
  );
  return {
    ...selected,
    loading: requestedChatLoading({
      taskSurface: opts.taskSurface,
      requestedChatId: opts.chatId,
      turnCount: opts.turns.length,
      ownedChatId: ownsSelectedTurnSet ? snapshot.chatId : "",
      stateLoading: selected.loading,
      hasCachedOwner: cachedEvents !== null,
    }),
    eventsByTask:
      ownsSelectedTurnSet
        ? snapshot.eventsByTask
        : cached && cachedEvents !== null
          ? eventsByTaskForOwners(opts.turns, cached.perTurn)
          : {},
    error: ownsSelectedTurnSet ? snapshot.error : null,
    staleSince: ownsSelectedTurnSet ? snapshot.staleSince : null,
    truncated: ownsSelectedTurnSet ? snapshot.truncated : false,
    retry,
  };
}
