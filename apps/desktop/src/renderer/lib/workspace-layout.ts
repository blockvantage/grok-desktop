/**
 * Per-conversation layout preferences (browser pin/keep-closed, files panel).
 */

export type WorkspaceLayout = {
  browserOpen: boolean;
  browserPinned: boolean;
  browserKeepClosed: boolean;
  filesPanelOpen: boolean;
};

export type WorkspaceLayoutStore = {
  byConversation: Record<string, WorkspaceLayout>;
};

const STORAGE_KEY = "grokdesk.workspace-layout.v1";

/**
 * Cap on remembered per-conversation layouts. Each entry is a handful of
 * booleans, but without a bound the map grows one entry per conversation ever
 * opened, forever, drifting toward the localStorage quota (past which
 * saveLayoutStore silently drops writes). 300 covers any realistic set of
 * active conversations; evicted entries simply fall back to the default layout.
 */
const MAX_LAYOUT_CONVERSATIONS = 300;

export function defaultWorkspaceLayout(): WorkspaceLayout {
  return {
    // Chat-first: never open the agent browser by default.
    browserOpen: false,
    browserPinned: false,
    browserKeepClosed: false,
    filesPanelOpen: false,
  };
}

/**
 * Whether layout restore should show the browser pane.
 * Pinned always restores open; otherwise only if the user left it open and
 * did not keep-closed. Failed/empty opens should not force a permanent tab.
 */
export function shouldRestoreBrowserOpen(layout: WorkspaceLayout): boolean {
  if (layout.browserKeepClosed) return false;
  if (layout.browserPinned) return true;
  return layout.browserOpen;
}

export function emptyLayoutStore(): WorkspaceLayoutStore {
  return { byConversation: {} };
}

export function loadLayoutStore(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): WorkspaceLayoutStore {
  if (!storage) return emptyLayoutStore();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyLayoutStore();
    if (raw.length > 500_000) return emptyLayoutStore();
    const parsed = JSON.parse(raw) as WorkspaceLayoutStore;
    if (!parsed?.byConversation || typeof parsed.byConversation !== "object") {
      return emptyLayoutStore();
    }
    const byConversation: WorkspaceLayoutStore["byConversation"] = {};
    let n = 0;
    for (const [cid, layout] of Object.entries(parsed.byConversation)) {
      if (n >= MAX_LAYOUT_CONVERSATIONS) break;
      if (typeof cid !== "string" || cid.length > 128) continue;
      if (!layout || typeof layout !== "object") continue;
      byConversation[cid] = layout as WorkspaceLayout;
      n += 1;
    }
    return { byConversation };
  } catch {
    return emptyLayoutStore();
  }
}

export function saveLayoutStore(
  store: WorkspaceLayoutStore,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

export function layoutForConversation(
  store: WorkspaceLayoutStore,
  conversationId: string,
): WorkspaceLayout {
  if (!conversationId) return defaultWorkspaceLayout();
  return store.byConversation[conversationId] ?? defaultWorkspaceLayout();
}

export function setLayoutForConversation(
  store: WorkspaceLayoutStore,
  conversationId: string,
  patch: Partial<WorkspaceLayout>,
): WorkspaceLayoutStore {
  if (!conversationId) return store;
  const prev = layoutForConversation(store, conversationId);
  // Rebuild with this conversation most-recent (by write order), then cap the
  // total so the map cannot grow unbounded. Re-inserting the touched key last
  // makes eviction drop the least-recently-written entries.
  const next: Record<string, WorkspaceLayout> = {};
  for (const [cid, layout] of Object.entries(store.byConversation)) {
    if (cid !== conversationId) next[cid] = layout;
  }
  next[conversationId] = { ...prev, ...patch };
  const keys = Object.keys(next);
  if (keys.length > MAX_LAYOUT_CONVERSATIONS) {
    for (const stale of keys.slice(0, keys.length - MAX_LAYOUT_CONVERSATIONS)) {
      delete next[stale];
    }
  }
  return { byConversation: next };
}
