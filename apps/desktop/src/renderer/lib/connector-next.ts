/**
 * Next connector recommendation — one best next MCP based on what is enabled.
 * Surfaces in Settings tools or Home discovery without a second catalog.
 */

export type ConnectorLike = {
  id: string;
  name: string;
  category?: string;
  recommended?: boolean;
  /** Needs API key / env before enable. */
  needsCredentials?: boolean;
  description?: string;
};

export type ConnectorNextSuggestion = {
  presetId: string;
  name: string;
  reason: string;
  needsCredentials: boolean;
};

/** Preferred enable order for free/local essentials. */
const PREFERENCE_ORDER = [
  "filesystem",
  "fetch",
  "memory",
  "sequential-thinking",
  "git",
  "brave-search",
  "github",
  "postgres",
  "slack",
  "puppeteer",
];

const REASONS: Record<string, string> = {
  filesystem: "Let Grok read and organize project files safely",
  fetch: "Pull public web pages into research without leaving Desk",
  memory: "Persist standing context across conversations",
  "sequential-thinking": "Stronger multi-step reasoning on hard goals",
  git: "Inspect diffs and history in your local repos",
  "brave-search": "Live web search for up-to-date answers",
  github: "Issues, PRs, and repo context from GitHub",
  postgres: "Query your databases with approval gates",
  slack: "Draft and research from Slack workspaces",
  puppeteer: "Automated browser workflows beyond the in-app pane",
};

/**
 * Pick the single best next connector not already enabled.
 * Prefers recommended free essentials first.
 */
export function pickNextConnector(input: {
  catalog: ConnectorLike[];
  enabledIds: string[];
}): ConnectorNextSuggestion | null {
  const enabled = new Set(input.enabledIds.map((id) => id.toLowerCase()));
  const byId = new Map(
    input.catalog.map((c) => [c.id.toLowerCase(), c] as const),
  );

  // Walk preference order first.
  for (const id of PREFERENCE_ORDER) {
    if (enabled.has(id)) continue;
    const c = byId.get(id);
    if (!c) continue;
    return {
      presetId: c.id,
      name: c.name,
      reason: REASONS[id] ?? c.description ?? "Expand what Grok can do",
      needsCredentials: Boolean(c.needsCredentials),
    };
  }

  // Then any recommended not enabled.
  const recommended = input.catalog
    .filter((c) => c.recommended && !enabled.has(c.id.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (recommended[0]) {
    const c = recommended[0];
    return {
      presetId: c.id,
      name: c.name,
      reason: c.description ?? "Recommended for your desk",
      needsCredentials: Boolean(c.needsCredentials),
    };
  }

  // Then first remaining free (no credentials).
  const free = input.catalog.find(
    (c) => !enabled.has(c.id.toLowerCase()) && !c.needsCredentials,
  );
  if (free) {
    return {
      presetId: free.id,
      name: free.name,
      reason: free.description ?? "Available without extra credentials",
      needsCredentials: false,
    };
  }

  // Last: anything left.
  const any = input.catalog.find((c) => !enabled.has(c.id.toLowerCase()));
  if (!any) return null;
  return {
    presetId: any.id,
    name: any.name,
    reason: any.description ?? "Expand your connector set",
    needsCredentials: Boolean(any.needsCredentials),
  };
}
