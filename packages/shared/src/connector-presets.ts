/**
 * Curated MCP connector gallery — inspired by Claude Desktop / Cowork connector
 * catalogs: local files, web research, git/dev, productivity, knowledge, automation.
 * One-click enable merges into settings.mcpServers.
 *
 * Packages are checked against npm/PyPI (2026-07). Broken packages use uvx/python
 * or maintained successors. Deprecated npm archives are marked and excluded from
 * one-click recommended enable.
 */

export type ConnectorCategory =
  | "essentials"
  | "local"
  | "web"
  | "dev"
  | "productivity"
  | "knowledge"
  | "data"
  | "automation";

export type ConnectorRuntime = "npx" | "uvx";
export type ConnectorStatus = "active" | "deprecated";

export const CONNECTOR_CATEGORIES: Array<{
  id: ConnectorCategory | "all" | "recommended";
  label: string;
  description: string;
}> = [
  {
    id: "all",
    label: "All",
    description: "Every curated connector",
  },
  {
    id: "recommended",
    label: "Recommended",
    description: "Best first-run set for most Desk users",
  },
  {
    id: "essentials",
    label: "Essentials",
    description: "Core day-one tools every agent needs",
  },
  {
    id: "local",
    label: "Local",
    description: "Files, git, and machine-local context",
  },
  {
    id: "web",
    label: "Web & research",
    description: "Fetch pages, search, and browse",
  },
  {
    id: "dev",
    label: "Developer",
    description: "GitHub, GitLab, Docker, CI-adjacent tools",
  },
  {
    id: "productivity",
    label: "Productivity",
    description: "Slack, Notion, calendars, work OS",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    description: "Memory graphs and long-lived facts",
  },
  {
    id: "data",
    label: "Data",
    description: "SQL databases and structured stores",
  },
  {
    id: "automation",
    label: "Automation",
    description: "Browser control and multi-step workflows",
  },
];

export interface ConnectorPreset {
  id: string;
  name: string;
  /** Short blurb for cards */
  description: string;
  /** Longer copy for the detail panel / empty states */
  longDescription: string;
  /** What you get when this is on */
  capabilities: string[];
  /** Setup or auth notes shown in UI */
  setupNotes?: string;
  category: ConnectorCategory;
  /** Highlighted in Recommended filter and first-run hints */
  recommended: boolean;
  /** Needs an API token / OAuth before tools work end-to-end */
  requiresAuth: boolean;
  /** MCP server id stored in settings.mcpServers */
  serverId: string;
  /** How the server process is launched */
  runtime: ConnectorRuntime;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Package identity for smoke tests (npm name or PyPI name) */
  packageName: string;
  /** active = healthy registry package; deprecated = archived but still listed */
  status: ConnectorStatus;
  /** Free-form tags for search + chips */
  tags: string[];
  /** Sort within category (lower first) */
  sortOrder: number;
  /** Optional risk hint for UI */
  riskLevel?: "low" | "medium" | "high";
}

/**
 * Official / widely used MCP packages.
 * Token placeholders use ${ENV_VAR} and expand at spawn (not at enable).
 */
export const CONNECTOR_PRESETS: ConnectorPreset[] = [
  // ── Essentials ──────────────────────────────────────────
  {
    id: "filesystem",
    name: "Filesystem",
    description:
      "Read and write files in your home directory and project folders.",
    longDescription:
      "The default local connector used by Claude Desktop and similar cowork apps. Grok can list, read, and edit files inside allowed roots without leaving Desk.",
    capabilities: [
      "Read / write workspace files",
      "Organize folders",
      "Open deliverables Grok creates",
    ],
    category: "essentials",
    recommended: true,
    requiresAuth: false,
    serverId: "filesystem",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${HOME}"],
    packageName: "@modelcontextprotocol/server-filesystem",
    status: "active",
    tags: ["files", "local", "default", "essentials"],
    sortOrder: 10,
    riskLevel: "medium",
  },
  {
    id: "fetch",
    name: "Web fetch",
    description: "Pull public URLs for research, docs, and content drafts.",
    longDescription:
      "Python MCP fetch server (PyPI mcp-server-fetch) via uvx. Use when you need GET of public pages without a full browser stack. Requires uv (uvx) on PATH.",
    capabilities: [
      "GET public pages",
      "Pull docs into the workspace",
      "Support research skills",
    ],
    setupNotes: "Requires uv (https://github.com/astral-sh/uv) so `uvx` works.",
    category: "essentials",
    recommended: true,
    requiresAuth: false,
    serverId: "fetch",
    runtime: "uvx",
    command: "uvx",
    args: ["mcp-server-fetch"],
    packageName: "mcp-server-fetch",
    status: "active",
    tags: ["web", "research", "http", "essentials", "uvx"],
    sortOrder: 20,
    riskLevel: "low",
  },
  {
    id: "memory-mcp",
    name: "Knowledge graph memory",
    description:
      "Persist entities and relations across chats (beyond Desk memory).",
    longDescription:
      "MCP knowledge-graph memory used in Claude Desktop demos. Complements Grok Desk standing memory with a portable graph of people, projects, and facts.",
    capabilities: [
      "Store entities & relations",
      "Recall across sessions",
      "Share facts with MCP tools",
    ],
    category: "knowledge",
    recommended: true,
    requiresAuth: false,
    serverId: "memory",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    packageName: "@modelcontextprotocol/server-memory",
    status: "active",
    tags: ["memory", "knowledge", "graph"],
    sortOrder: 30,
    riskLevel: "low",
  },
  {
    id: "sequential-thinking",
    name: "Sequential thinking",
    description: "Structured multi-step reasoning for complex plans.",
    longDescription:
      "Breaks hard problems into explicit thought steps — useful for chief-of-staff planning, architecture, and research synthesis.",
    capabilities: [
      "Step-by-step plans",
      "Self-check reasoning",
      "Better long tasks",
    ],
    category: "essentials",
    recommended: true,
    requiresAuth: false,
    serverId: "sequential-thinking",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    packageName: "@modelcontextprotocol/server-sequential-thinking",
    status: "active",
    tags: ["planning", "reasoning", "essentials"],
    sortOrder: 40,
    riskLevel: "low",
  },

  // ── Local ───────────────────────────────────────────────
  {
    id: "git",
    name: "Git (local)",
    description: "Inspect status, log, and diffs in local repositories.",
    longDescription:
      "Python MCP git server (PyPI mcp-server-git) via uvx. Point --repository at a repo path after enable if needed.",
    capabilities: ["git status", "log / diff", "Branch awareness"],
    setupNotes:
      "Requires uvx. Default repository root is $HOME — narrow to a repo path for focus.",
    category: "local",
    recommended: true,
    requiresAuth: false,
    serverId: "git",
    runtime: "uvx",
    command: "uvx",
    args: ["mcp-server-git", "--repository", "${HOME}"],
    packageName: "mcp-server-git",
    status: "active",
    tags: ["git", "dev", "local", "uvx"],
    sortOrder: 10,
    riskLevel: "low",
  },
  {
    id: "everything",
    name: "MCP playground",
    description: "Reference server with sample tools for testing the wire.",
    longDescription:
      "Official “everything” demo server — handy when validating MCP wiring, Desk settings, or teaching how tools appear in Grok.",
    capabilities: ["Sample tools", "Connectivity checks"],
    category: "local",
    recommended: false,
    requiresAuth: false,
    serverId: "everything",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    packageName: "@modelcontextprotocol/server-everything",
    status: "active",
    tags: ["debug", "sample", "local"],
    sortOrder: 90,
    riskLevel: "low",
  },

  // ── Web ─────────────────────────────────────────────────
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Web search via Brave Search API for grounded research.",
    longDescription:
      "Live search results for research briefs. Package is older on npm; still installable. Prefer native web tools when sufficient.",
    capabilities: ["Web search", "Source links", "Research briefs"],
    setupNotes:
      "Set BRAVE_API_KEY in Desk credentials or the environment before launch.",
    category: "web",
    recommended: false,
    requiresAuth: true,
    serverId: "brave-search",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: { BRAVE_API_KEY: "${BRAVE_API_KEY}" },
    packageName: "@modelcontextprotocol/server-brave-search",
    status: "deprecated",
    tags: ["search", "web", "research"],
    sortOrder: 10,
    riskLevel: "low",
  },
  {
    id: "puppeteer",
    name: "Browser (Puppeteer)",
    description: "Headless Chrome for pages that need a real browser.",
    longDescription:
      "Navigate and extract from JS-heavy sites. Archived-style npm package; use when fetch is not enough.",
    capabilities: ["Open pages", "Extract content", "Screenshots (via tools)"],
    category: "automation",
    recommended: false,
    requiresAuth: false,
    serverId: "puppeteer",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    packageName: "@modelcontextprotocol/server-puppeteer",
    status: "deprecated",
    tags: ["browser", "web", "automation"],
    sortOrder: 20,
    riskLevel: "medium",
  },
  {
    id: "google-maps",
    name: "Google Maps",
    description: "Places, directions, and geo context for local research.",
    longDescription:
      "Location-aware briefs. Older npm package; needs a Google Maps API key.",
    capabilities: ["Places search", "Directions", "Geo context"],
    setupNotes: "Set GOOGLE_MAPS_API_KEY in the environment or Desk secrets.",
    category: "web",
    recommended: false,
    requiresAuth: true,
    serverId: "google-maps",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-google-maps"],
    env: { GOOGLE_MAPS_API_KEY: "${GOOGLE_MAPS_API_KEY}" },
    packageName: "@modelcontextprotocol/server-google-maps",
    status: "deprecated",
    tags: ["maps", "geo", "web"],
    sortOrder: 30,
    riskLevel: "low",
  },

  // ── Dev ─────────────────────────────────────────────────
  {
    id: "github",
    name: "GitHub",
    description: "Issues, PRs, and repos via the GitHub MCP server package.",
    longDescription:
      "Developer connector for issues/PRs. npm package still resolves; GitHub is also shipping a newer official server — upgrade path in setup notes.",
    capabilities: ["Repos & issues", "Pull requests", "Code search"],
    setupNotes:
      "Set GITHUB_PERSONAL_ACCESS_TOKEN. Prefer fine-grained tokens with least privilege.",
    category: "dev",
    recommended: false,
    requiresAuth: true,
    serverId: "github",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
    },
    packageName: "@modelcontextprotocol/server-github",
    status: "deprecated",
    tags: ["github", "git", "dev", "prs"],
    sortOrder: 10,
    riskLevel: "medium",
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Projects, MRs, and issues on GitLab.com or self-hosted.",
    longDescription:
      "Parallel to GitHub for teams on GitLab. Older npm package.",
    capabilities: ["Merge requests", "Issues", "Projects"],
    setupNotes: "Set GITLAB_PERSONAL_ACCESS_TOKEN (and optional GITLAB_API_URL).",
    category: "dev",
    recommended: false,
    requiresAuth: true,
    serverId: "gitlab",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gitlab"],
    env: {
      GITLAB_PERSONAL_ACCESS_TOKEN: "${GITLAB_PERSONAL_ACCESS_TOKEN}",
      GITLAB_API_URL: "${GITLAB_API_URL}",
    },
    packageName: "@modelcontextprotocol/server-gitlab",
    status: "deprecated",
    tags: ["gitlab", "dev", "mr"],
    sortOrder: 20,
    riskLevel: "medium",
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Pull error and performance issues from Sentry projects.",
    longDescription:
      "Uses the maintained @sentry/mcp-server package (successor to the removed @modelcontextprotocol/server-sentry).",
    capabilities: ["List issues", "Error context", "Release awareness"],
    setupNotes: "Set SENTRY_ACCESS_TOKEN (and org/project as required by the server).",
    category: "dev",
    recommended: false,
    requiresAuth: true,
    serverId: "sentry",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@sentry/mcp-server"],
    env: {
      SENTRY_ACCESS_TOKEN: "${SENTRY_ACCESS_TOKEN}",
    },
    packageName: "@sentry/mcp-server",
    status: "active",
    tags: ["sentry", "ops", "errors", "dev"],
    sortOrder: 30,
    riskLevel: "low",
  },

  // ── Productivity ────────────────────────────────────────
  {
    id: "slack",
    name: "Slack",
    description: "Read channels and draft messages with Slack MCP tools.",
    longDescription:
      "Cowork staple for status updates and channel summaries. Older npm package; bot token required.",
    capabilities: ["Channel context", "Message drafts", "Team signals"],
    setupNotes: "Set SLACK_BOT_TOKEN (and team ID if your server requires it).",
    category: "productivity",
    recommended: false,
    requiresAuth: true,
    serverId: "slack",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    env: {
      SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}",
      SLACK_TEAM_ID: "${SLACK_TEAM_ID}",
    },
    packageName: "@modelcontextprotocol/server-slack",
    status: "deprecated",
    tags: ["slack", "chat", "productivity"],
    sortOrder: 10,
    riskLevel: "medium",
  },
  {
    id: "gdrive",
    name: "Google Drive",
    description: "Search and read Drive files the agent is allowed to see.",
    longDescription:
      "Document cowork flow. Older npm package; OAuth credentials required.",
    capabilities: ["Search Drive", "Read docs", "Export context"],
    setupNotes:
      "Requires Google OAuth credentials per server docs (GDRIVE_* env vars).",
    category: "productivity",
    recommended: false,
    requiresAuth: true,
    serverId: "gdrive",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gdrive"],
    env: {
      GDRIVE_CREDENTIALS_PATH: "${GDRIVE_CREDENTIALS_PATH}",
    },
    packageName: "@modelcontextprotocol/server-gdrive",
    status: "deprecated",
    tags: ["google", "drive", "docs", "productivity"],
    sortOrder: 20,
    riskLevel: "high",
  },

  // ── Data ────────────────────────────────────────────────
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Query a Postgres database with read-focused MCP tools.",
    longDescription:
      "Schema-aware SQL over a connection string. Args keep ${DATABASE_URL} placeholder until spawn.",
    capabilities: ["SQL queries", "Schema inspection"],
    setupNotes:
      "Set DATABASE_URL (never commit it). Expanded only when the agent session starts.",
    category: "data",
    recommended: false,
    requiresAuth: true,
    serverId: "postgres",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL}"],
    env: { DATABASE_URL: "${DATABASE_URL}" },
    packageName: "@modelcontextprotocol/server-postgres",
    status: "deprecated",
    tags: ["sql", "postgres", "data"],
    sortOrder: 10,
    riskLevel: "high",
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Query a local SQLite file for offline analysis.",
    longDescription:
      "Python MCP sqlite server (PyPI mcp-server-sqlite) via uvx.",
    capabilities: ["Local SQL", "CSV-style analysis"],
    setupNotes:
      "Requires uvx. Default points at ${HOME}/data.sqlite — change after enable.",
    category: "data",
    recommended: false,
    requiresAuth: false,
    serverId: "sqlite",
    runtime: "uvx",
    command: "uvx",
    args: ["mcp-server-sqlite", "--db-path", "${HOME}/data.sqlite"],
    packageName: "mcp-server-sqlite",
    status: "active",
    tags: ["sql", "sqlite", "local", "data", "uvx"],
    sortOrder: 20,
    riskLevel: "low",
  },

  // ── Knowledge / automation extras ───────────────────────
  {
    id: "aws-kb",
    name: "AWS Knowledge Base",
    description: "Retrieve from an Amazon Bedrock knowledge base.",
    longDescription:
      "Enterprise knowledge retrieval. Older npm package; AWS credentials required.",
    capabilities: ["KB retrieval", "Enterprise docs"],
    setupNotes: "Requires AWS credentials and Bedrock KB configuration.",
    category: "knowledge",
    recommended: false,
    requiresAuth: true,
    serverId: "aws-kb",
    runtime: "npx",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-aws-kb-retrieval"],
    env: {
      AWS_ACCESS_KEY_ID: "${AWS_ACCESS_KEY_ID}",
      AWS_SECRET_ACCESS_KEY: "${AWS_SECRET_ACCESS_KEY}",
      AWS_REGION: "${AWS_REGION}",
    },
    packageName: "@modelcontextprotocol/server-aws-kb-retrieval",
    status: "deprecated",
    tags: ["aws", "knowledge", "enterprise"],
    sortOrder: 40,
    riskLevel: "high",
  },
];

export function listConnectorPresets(): ConnectorPreset[] {
  return CONNECTOR_PRESETS.map((p) => ({
    ...p,
    tags: [...p.tags],
    capabilities: [...p.capabilities],
    env: p.env ? { ...p.env } : undefined,
  })).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function getConnectorPreset(id: string): ConnectorPreset | undefined {
  return CONNECTOR_PRESETS.find((p) => p.id === id);
}

export function listRecommendedConnectorIds(): string[] {
  return CONNECTOR_PRESETS.filter(
    (p) => p.recommended && p.status === "active",
  ).map((p) => p.id);
}

/** Packages that first-run enableRecommended will turn on (free + active). */
export function listAutoEnableConnectorIds(): string[] {
  return CONNECTOR_PRESETS.filter(
    (p) =>
      p.recommended &&
      p.status === "active" &&
      !p.requiresAuth &&
      p.runtime === "npx",
  ).map((p) => p.id);
}

export type McpServerRow = {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
};

export interface ConnectorFilter {
  /** Free text over name, description, tags, category */
  query?: string;
  /** Category id, or "all" / "recommended" */
  category?: ConnectorCategory | "all" | "recommended";
  /** Only recommended */
  recommendedOnly?: boolean;
  /** Only connectors currently enabled in settings */
  enabledOnly?: boolean;
  /** Server ids that are currently enabled */
  enabledServerIds?: string[];
  /** Hide connectors that need auth (first-run mode) */
  hideAuthRequired?: boolean;
  /** Hide deprecated packages */
  hideDeprecated?: boolean;
}

/** Pure filter used by Settings UI and tests. */
export function filterConnectorPresets(
  presets: ConnectorPreset[],
  filter: ConnectorFilter = {},
): ConnectorPreset[] {
  const q = (filter.query ?? "").trim().toLowerCase();
  const cat = filter.category ?? "all";
  const enabled = new Set(filter.enabledServerIds ?? []);

  return presets
    .filter((p) => {
      if (filter.recommendedOnly || cat === "recommended") {
        if (!p.recommended || p.status !== "active") return false;
      }
      if (cat !== "all" && cat !== "recommended" && p.category !== cat) {
        return false;
      }
      if (filter.enabledOnly && !enabled.has(p.serverId)) return false;
      if (filter.hideAuthRequired && p.requiresAuth) return false;
      if (filter.hideDeprecated && p.status === "deprecated") return false;
      if (!q) return true;
      const hay = [
        p.name,
        p.description,
        p.longDescription,
        p.category,
        p.setupNotes ?? "",
        p.runtime,
        p.status,
        ...p.tags,
        ...p.capabilities,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => {
      if (cat === "all" && a.recommended !== b.recommended) {
        return a.recommended ? -1 : 1;
      }
      return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    });
}

/**
 * Expand only HOME/USER for display paths. Secrets stay as ${VAR} until spawn.
 */
export function expandSafePathArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return args.map((a) => expandHomeUserOnly(a, env));
}

/** Full expansion including secrets — spawn-time only. */
export function expandPresetArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return args.map((a) => expandTemplate(a, env));
}

export function expandPresetEnv(
  envMap: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  if (!envMap) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(envMap)) {
    out[k] = expandTemplate(v, env);
  }
  return out;
}

/** Keep placeholders for secrets; only expand HOME/USER when storing settings. */
export function expandPresetEnvForStorage(
  envMap: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  if (!envMap) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(envMap)) {
    // Never bake secret values into persisted settings — keep ${VAR}.
    if (/\$\{[A-Z0-9_]+\}/.test(v) && !/\$\{HOME\}|\$\{USER\}/.test(v)) {
      out[k] = v;
    } else {
      out[k] = expandHomeUserOnly(v, env);
    }
  }
  return out;
}

function expandHomeUserOnly(value: string, env: NodeJS.ProcessEnv): string {
  const home = env.HOME || env.USERPROFILE || "/tmp";
  const user = env.USER || env.USERNAME || "user";
  return value
    .replaceAll("${HOME}", home)
    .replaceAll("$HOME", home)
    .replaceAll("${USER}", user);
}

function expandTemplate(value: string, env: NodeJS.ProcessEnv): string {
  const home = env.HOME || env.USERPROFILE || "/tmp";
  const user = env.USER || env.USERNAME || "user";
  let out = value
    .replaceAll("${HOME}", home)
    .replaceAll("$HOME", home)
    .replaceAll("${USER}", user);
  out = out.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name: string) => {
    if (name === "HOME" || name === "USER") return match;
    const v = env[name];
    return v != null && v !== "" ? v : match;
  });
  return out;
}

/**
 * Env var names referenced as ${NAME} in a preset's args/env
 * (excludes HOME/USER path tokens).
 */
export function listPresetEnvPlaceholders(preset: ConnectorPreset): string[] {
  const names = new Set<string>();
  const scan = (s: string) => {
    for (const m of s.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
      const name = m[1]!;
      if (name === "HOME" || name === "USER") continue;
      names.add(name);
    }
  };
  for (const a of preset.args) scan(a);
  if (preset.env) {
    for (const v of Object.values(preset.env)) scan(v);
  }
  return [...names].sort();
}

/**
 * Merge a preset into the existing mcpServers list (enable or upsert).
 * Stores placeholders for secrets by default; HOME/USER may be expanded for path UX.
 * When `credentials` is provided, those values are stored as literals on the row
 * env map so they flow into project TOML without requiring process.env at write time.
 */
export function enableConnectorPreset(
  current: McpServerRow[],
  presetId: string,
  env: NodeJS.ProcessEnv = process.env,
  credentials?: Record<string, string>,
): {
  servers: McpServerRow[];
  preset: ConnectorPreset;
  /** Env var names still unresolved after expansion (auth connectors). */
  missingEnv: string[];
} {
  const preset = getConnectorPreset(presetId);
  if (!preset) {
    throw new Error(`Unknown connector preset: ${presetId}`);
  }
  const creds = sanitizeCredentials(credentials);
  const effectiveEnv: NodeJS.ProcessEnv = creds
    ? { ...env, ...creds }
    : env;
  const storedEnv: Record<string, string> = {
    ...(expandPresetEnvForStorage(preset.env, effectiveEnv) ?? {}),
  };
  // Bake supplied credentials as literal values (not ${VAR}) so the TOML writer
  // and spawn path receive them without reading the host process env.
  if (creds) {
    for (const [k, v] of Object.entries(creds)) {
      storedEnv[k] = v;
    }
  }
  const row: McpServerRow = {
    id: preset.serverId,
    command: preset.command,
    args: expandSafePathArgs(preset.args, effectiveEnv),
    env: Object.keys(storedEnv).length > 0 ? storedEnv : undefined,
    enabled: true,
  };
  const others = current.filter((m) => m.id !== row.id);
  return {
    servers: [...others, row],
    preset,
    missingEnv: listUnresolvedEnvPlaceholders(preset, effectiveEnv),
  };
}

function sanitizeCredentials(
  credentials?: Record<string, string>,
): Record<string, string> | undefined {
  if (!credentials) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(credentials)) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) continue;
    out[k] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Env keys referenced as ${NAME} that are empty/unset after expansion. */
export function listUnresolvedEnvPlaceholders(
  preset: ConnectorPreset,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return listPresetEnvPlaceholders(preset).filter((name) => !env[name]);
}

/** True when a stored env value is still an unexpanded ${VAR} placeholder. */
export function isEnvPlaceholderValue(value: string): boolean {
  return Boolean(value.match(/^\$\{[A-Z][A-Z0-9_]*\}$/));
}

/**
 * Whether a server row already has non-placeholder values for the given env names.
 * Used by UI to show a "configured" state without reading secret values back.
 */
export function hasConfiguredCredentials(
  row: McpServerRow | undefined,
  names: string[],
): boolean {
  if (!row?.env || names.length === 0) return false;
  return names.every((n) => {
    const v = row.env?.[n];
    return typeof v === "string" && v.length > 0 && !isEnvPlaceholderValue(v);
  });
}

export function disableConnectorPreset(
  current: McpServerRow[],
  presetId: string,
): McpServerRow[] {
  const preset = getConnectorPreset(presetId);
  if (!preset) return current.slice();
  return current.map((m) =>
    m.id === preset.serverId ? { ...m, enabled: false } : m,
  );
}

/**
 * Enable free recommended **npx** active presets that are not already present.
 * Does not overwrite user-customized command/args for an existing server id.
 * uvx connectors are listed as recommended in the UI but not auto-enabled
 * (uv may be missing on first run).
 */
export function enableRecommendedConnectors(
  current: McpServerRow[],
  env: NodeJS.ProcessEnv = process.env,
): McpServerRow[] {
  let servers = current.slice();
  const existingIds = new Set(servers.map((s) => s.id));
  for (const p of CONNECTOR_PRESETS.filter(
    (x) =>
      x.recommended &&
      !x.requiresAuth &&
      x.status === "active" &&
      x.runtime === "npx",
  )) {
    if (existingIds.has(p.serverId)) continue;
    servers = enableConnectorPreset(servers, p.id, env).servers;
    existingIds.add(p.serverId);
  }
  return servers;
}
