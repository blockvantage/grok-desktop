/**
 * Phase 3: reviewable memory suggestions from completed-task takeaways.
 *
 * Suggestions are draft-only until the user approves (or edits then approves).
 * Never silently commit to durable memory.
 */

export type MemorySuggestionStatus = "pending" | "approved" | "dismissed";

export type MemorySuggestion = {
  id: string;
  /** Source task id (for dedupe). */
  taskId: string;
  title: string;
  content: string;
  kind: "episodic" | "preference" | "project" | "standing";
  status: MemorySuggestionStatus;
  createdAt: string;
  /** True when content looked potentially sensitive (still reviewable). */
  sensitiveHint?: boolean;
};

export type MemorySuggestionStore = {
  suggestions: MemorySuggestion[];
};

const STORAGE_KEY = "grokdesk.memorySuggestions.v1";
const MAX_SUGGESTIONS = 40;
const TITLE_MAX = 120;
const CONTENT_MAX = 8_000;

/** Patterns that suggest the user should review carefully before approve. */
const SENSITIVE_HINT =
  /\b(password|api[_-]?key|secret|token|ssn|credit\s*card|private\s*key)\b/i;

export function emptyMemorySuggestionStore(): MemorySuggestionStore {
  return { suggestions: [] };
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

export function loadMemorySuggestionStore(
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): MemorySuggestionStore {
  if (!storage) return emptyMemorySuggestionStore();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 2_000_000) return emptyMemorySuggestionStore();
    const parsed = JSON.parse(raw) as Partial<MemorySuggestionStore>;
    if (!Array.isArray(parsed.suggestions)) return emptyMemorySuggestionStore();
    return {
      suggestions: parsed.suggestions
        .filter((s) => s && typeof s === "object" && typeof (s as MemorySuggestion).id === "string")
        .slice(0, MAX_SUGGESTIONS)
        .map((s) => normalizeSuggestion(s as MemorySuggestion)),
    };
  } catch {
    return emptyMemorySuggestionStore();
  }
}

export function saveMemorySuggestionStore(
  store: MemorySuggestionStore,
  storage: Pick<Storage, "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota */
  }
}

function normalizeSuggestion(s: MemorySuggestion): MemorySuggestion {
  return {
    id: String(s.id).slice(0, 128),
    taskId: String(s.taskId ?? "").slice(0, 128),
    title: String(s.title ?? "").trim().slice(0, TITLE_MAX) || "Suggestion",
    content: String(s.content ?? "").trim().slice(0, CONTENT_MAX),
    kind: (["episodic", "preference", "project", "standing"] as const).includes(
      s.kind as MemorySuggestion["kind"],
    )
      ? s.kind
      : "episodic",
    status: (["pending", "approved", "dismissed"] as const).includes(
      s.status as MemorySuggestionStatus,
    )
      ? s.status
      : "pending",
    createdAt: s.createdAt || new Date().toISOString(),
    sensitiveHint: Boolean(s.sensitiveHint),
  };
}

export function makeSuggestionId(now = Date.now()): string {
  return `msug_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Whether takeaways text is usable enough to surface as a review suggestion.
 * Requires non-trivial content beyond a bare goal line.
 */
export function isUsableTakeawaysContent(content: string): boolean {
  const c = content.trim();
  if (c.length < 48) return false;
  // Shared takeaways builder includes this when no answer was captured.
  if (/No assistant answer captured yet/i.test(c) && c.length < 120) {
    return false;
  }
  return true;
}

export function looksSensitive(content: string): boolean {
  return SENSITIVE_HINT.test(content);
}

/**
 * Draft a suggestion from completed-task takeaways. Does not write durable memory.
 * Dedupes pending items by taskId.
 */
export function createSuggestionFromTakeaways(
  store: MemorySuggestionStore,
  input: {
    taskId: string;
    goal: string;
    title?: string | null;
    content: string;
    now?: string;
  },
): { store: MemorySuggestionStore; suggestion: MemorySuggestion | null } {
  if (!input.taskId.trim()) return { store, suggestion: null };
  if (!isUsableTakeawaysContent(input.content)) {
    return { store, suggestion: null };
  }

  const existing = store.suggestions.find(
    (s) => s.taskId === input.taskId && s.status === "pending",
  );
  if (existing) {
    const updated: MemorySuggestion = {
      ...existing,
      title: (
        input.title?.trim() ||
        existing.title ||
        `Takeaways: ${input.goal.slice(0, 40)}`
      ).slice(0, TITLE_MAX),
      content: input.content.trim().slice(0, CONTENT_MAX),
      sensitiveHint: looksSensitive(input.content),
    };
    return {
      store: {
        suggestions: store.suggestions.map((s) =>
          s.id === existing.id ? updated : s,
        ),
      },
      suggestion: updated,
    };
  }

  // Already approved or dismissed for this task — do not re-nag.
  const settled = store.suggestions.some(
    (s) =>
      s.taskId === input.taskId &&
      (s.status === "approved" || s.status === "dismissed"),
  );
  if (settled) return { store, suggestion: null };

  const label = (input.title?.trim() || input.goal).slice(0, 60);
  const suggestion: MemorySuggestion = {
    id: makeSuggestionId(),
    taskId: input.taskId,
    title: `Takeaways: ${label}`.slice(0, TITLE_MAX),
    content: input.content.trim().slice(0, CONTENT_MAX),
    kind: "episodic",
    status: "pending",
    createdAt: input.now ?? new Date().toISOString(),
    sensitiveHint: looksSensitive(input.content),
  };

  return {
    store: {
      suggestions: [suggestion, ...store.suggestions].slice(0, MAX_SUGGESTIONS),
    },
    suggestion,
  };
}

/** Pending suggestions for the Memory review queue (newest first). */
export function pendingMemorySuggestions(
  store: MemorySuggestionStore,
): MemorySuggestion[] {
  return store.suggestions.filter((s) => s.status === "pending");
}

export function editMemorySuggestion(
  store: MemorySuggestionStore,
  id: string,
  patch: { title?: string; content?: string; kind?: MemorySuggestion["kind"] },
): MemorySuggestionStore {
  return {
    suggestions: store.suggestions.map((s) => {
      if (s.id !== id) return s;
      const next = {
        ...s,
        ...(patch.title !== undefined
          ? { title: patch.title.trim().slice(0, TITLE_MAX) }
          : {}),
        ...(patch.content !== undefined
          ? {
              content: patch.content.trim().slice(0, CONTENT_MAX),
              sensitiveHint: looksSensitive(patch.content),
            }
          : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      };
      return next;
    }),
  };
}

/**
 * Mark approved. Caller must upsert durable memory separately after approve.
 * Returns the suggestion payload for memory.upsert (or null if missing).
 */
export function approveMemorySuggestion(
  store: MemorySuggestionStore,
  id: string,
  patch?: { title?: string; content?: string; kind?: MemorySuggestion["kind"] },
): {
  store: MemorySuggestionStore;
  approved: MemorySuggestion | null;
} {
  let working = store;
  if (patch) {
    working = editMemorySuggestion(store, id, patch);
  }
  const found = working.suggestions.find((s) => s.id === id);
  if (!found || found.status === "dismissed") {
    return { store: working, approved: null };
  }
  const approved: MemorySuggestion = { ...found, status: "approved" };
  return {
    store: {
      suggestions: working.suggestions.map((s) =>
        s.id === id ? approved : s,
      ),
    },
    approved,
  };
}

export function dismissMemorySuggestion(
  store: MemorySuggestionStore,
  id: string,
): MemorySuggestionStore {
  return {
    suggestions: store.suggestions.map((s) =>
      s.id === id ? { ...s, status: "dismissed" as const } : s,
    ),
  };
}

/** Upsert fields for durable memory after explicit approve. */
export function suggestionToMemoryUpsert(s: MemorySuggestion): {
  kind: string;
  title: string;
  content: string;
} {
  return {
    kind: s.kind,
    title: s.title,
    content: s.content,
  };
}

export {
  STORAGE_KEY as MEMORY_SUGGESTION_STORAGE_KEY,
  memoryStorage as memorySuggestionMemoryStorage,
};
