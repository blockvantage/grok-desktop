export type BrowserUiState = {
  open: boolean;
  pinned: boolean;
  keepClosed: boolean;
};

export const initialBrowserUiState = (): BrowserUiState => ({
  open: false,
  pinned: false,
  keepClosed: false,
});

export type BrowserUiEvent =
  | { type: "agent_browser_activity" }
  | { type: "user_open" }
  | { type: "user_open_failed"; wasOpen: boolean }
  | { type: "user_toggle" }
  | { type: "user_collapse" }
  | { type: "user_pin"; pinned: boolean };

/**
 * Hybrid open rules for the agent browser pane:
 * - First real browser_* tool activity auto-opens unless user kept closed
 * - Creating files / HTML alone must NOT open the pane (chat-first)
 * - User toggle open↔closed; closing sets keepClosed
 * - Pin keeps open while idle
 */
export function reduceBrowserUi(
  state: BrowserUiState,
  event: BrowserUiEvent,
): BrowserUiState {
  switch (event.type) {
    case "agent_browser_activity":
      if (state.keepClosed) return state;
      if (state.open) return state;
      return { ...state, open: true };
    case "user_open":
      return { ...state, open: true, keepClosed: false };
    case "user_open_failed":
      return {
        ...state,
        open: state.pinned || event.wasOpen,
        keepClosed: false,
      };
    case "user_toggle":
      if (state.open) {
        return { ...state, open: false, keepClosed: true, pinned: false };
      }
      return { ...state, open: true, keepClosed: false };
    case "user_collapse":
      return { ...state, open: false, keepClosed: true, pinned: false };
    case "user_pin":
      return {
        ...state,
        pinned: event.pinned,
        open: event.pinned ? true : state.open,
        keepClosed: event.pinned ? false : state.keepClosed,
      };
  }
}

export function isBrowserToolPayload(tool: unknown): boolean {
  return typeof tool === "string" && tool.startsWith("browser_");
}

/**
 * BrowserService status is the authoritative signal that the native in-app
 * browser actually started navigating. Grok's streaming-json output may omit
 * MCP tool events, so the pane cannot depend on the transcript alone.
 */
export function statusShowsBrowserActivity(status: {
  active: boolean;
  loading: boolean;
  url: string;
  lastAction: string | null;
  error?: string | null;
} | null): boolean {
  if (!status || !isBrowserToolPayload(status.lastAction)) return false;
  // Load-start is intent, not proof. Waiting for the settled status prevents
  // a denied or failed navigation from opening an empty native pane. An
  // explicitly opened pane remains open because this predicate only drives
  // auto-open; it never collapses BrowserUiState.
  return !status.loading && !status.error && status.url.trim().length > 0;
}

/**
 * True when the stream shows a successful in-app browser open (not a failed
 * harvest/tool attempt). Used so a historical Invalid URL tool_request does
 * not force the pane open on every chat revisit.
 */
export function streamHasSuccessfulBrowserOpen(
  events: Array<{ kind: string; payload?: Record<string, unknown> | null }>,
): boolean {
  for (const e of events) {
    if (e.kind !== "tool_result") continue;
    const tool = e.payload?.tool;
    const ok = e.payload?.ok;
    if (ok !== true) continue;
    // Modern receipts always name the tool. Only browser_open proves that a
    // page exists to restore; successful reads/clicks must not reopen a pane
    // after a failed or unresolved navigation.
    if (typeof tool === "string") {
      if (tool === "browser_open") return true;
      continue;
    }
    // Legacy one-click receipts omitted tool but did include the provider.
    // Retain that narrow fallback so existing successful panes still restore.
    if (e.payload?.browserProvider === "desk-browser") return true;
  }
  // A request is intent, not proof that the host loaded anything. Live opens
  // are driven by BrowserService status once authorization has succeeded.
  return false;
}
