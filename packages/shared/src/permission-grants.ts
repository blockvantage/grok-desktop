/**
 * Desk-owned remembered tool grants (Phase 4.1 / A5).
 *
 * Aligns with upstream `remember_tool_approvals`: per-project, persisted in
 * Desk's own client file `permission_grok-desk.toml` (never the TUI's
 * `permission.toml`). Matching is fail-closed on ambiguous patterns.
 * Deny always wins over allow.
 */

export const DESK_PERMISSION_CLIENT = "grok-desk";

export type GrantDecision = "allow" | "deny";

export type RememberedGrant = {
  id: string;
  /** Workspace / repo root this grant is scoped to. */
  scopeRoot: string;
  /** Compact rule, e.g. `Bash(git *)` or `Edit`. */
  toolPattern: string;
  decision: GrantDecision;
  createdAt: string;
};

export type GrantMatchInput = {
  tool?: string | null;
  command?: string | null;
  title?: string | null;
};

/** File name for Desk's per-client grant file. */
export function deskPermissionFileName(
  client: string = DESK_PERMISSION_CLIENT,
): string {
  const safe = client.replace(/[^a-zA-Z0-9._-]/g, "-") || DESK_PERMISSION_CLIENT;
  return `permission_${safe}.toml`;
}

/** URL-encoded scope root for `$GROK_HOME/sessions/<id>/`. */
export function encodeGrantScopeRoot(root: string): string {
  return encodeURIComponent(root.replace(/\\/g, "/").replace(/\/+$/, ""));
}

export function grantFileRelativePath(
  scopeRoot: string,
  client: string = DESK_PERMISSION_CLIENT,
): string {
  return `sessions/${encodeGrantScopeRoot(scopeRoot)}/${deskPermissionFileName(client)}`;
}

export function parseCompactRule(pattern: string): {
  tool: string;
  glob: string | null;
} | null {
  const t = pattern.trim();
  if (!t) return null;
  const m = t.match(/^([A-Za-z][A-Za-z0-9]*)\((.*)\)$/);
  if (m) {
    const glob = m[2]!.trim();
    if (!glob) return null;
    return { tool: m[1]!.toLowerCase(), glob };
  }
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(t)) {
    return { tool: t.toLowerCase(), glob: null };
  }
  return null;
}

function globToRegExp(glob: string): RegExp | null {
  // Fail closed: empty glob is not a match-all for allow/deny of a tool class
  // unless the compact form was `Tool` with no parens (handled separately).
  if (!glob) return null;
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") out += ".*";
    else if (c === "?") out += ".";
    else out += c.replace(/[|\\{}()[\]^$+.]/g, "\\$&");
  }
  out += "$";
  try {
    return new RegExp(out);
  } catch {
    return null;
  }
}

function toolClassFromInput(input: GrantMatchInput): string {
  const blob = `${input.tool ?? ""} ${input.title ?? ""}`.toLowerCase();
  if (/\bshell\b|\bbash\b|\bterminal\b|\bexec\b|\bcommand\b/.test(blob)) {
    return "bash";
  }
  if (/\bedit\b|\bwrite\b/.test(blob)) return "edit";
  if (/\bread\b/.test(blob)) return "read";
  if (/\bgrep\b|\bglob\b/.test(blob)) return "grep";
  if (/\bmcp\b/.test(blob)) return "mcp";
  if (/\bwebfetch\b|\bfetch\b/.test(blob)) return "webfetch";
  if (/\bwebsearch\b|\bsearch\b/.test(blob)) return "websearch";
  const raw = (input.tool ?? "").toLowerCase();
  return raw || "bash";
}

function haystack(input: GrantMatchInput): string {
  return (input.command ?? input.title ?? input.tool ?? "").trim();
}

/**
 * Whether `pattern` matches this tool invocation.
 * Ambiguous / unparsable patterns never match (fail closed).
 */
export function grantPatternMatches(
  pattern: string,
  input: GrantMatchInput,
): boolean {
  const parsed = parseCompactRule(pattern);
  if (!parsed) return false;
  const klass = toolClassFromInput(input);
  const ruleTool = parsed.tool === "write" ? "edit" : parsed.tool;
  const callTool = klass === "write" ? "edit" : klass;
  if (ruleTool !== callTool && ruleTool !== "any") return false;
  if (parsed.glob == null) return true;
  const re = globToRegExp(parsed.glob);
  if (!re) return false;
  const text = haystack(input);
  if (!text) return false;
  if (re.test(text)) return true;
  // Prefix form without a trailing * still matches a leading command.
  if (!parsed.glob.includes("*") && !parsed.glob.includes("?")) {
    return text === parsed.glob || text.startsWith(`${parsed.glob} `);
  }
  // `git status *` must also match the bare prefix `git status`.
  if (parsed.glob.endsWith(" *")) {
    const prefix = parsed.glob.slice(0, -2);
    if (text === prefix || text.startsWith(`${prefix} `)) return true;
  }
  return false;
}

/**
 * Resolve remembered grants. Deny wins. No match → null (prompt / default).
 */
export function matchRememberedGrant(
  grants: readonly RememberedGrant[],
  input: GrantMatchInput,
): RememberedGrant | null {
  const hits = grants.filter((g) => grantPatternMatches(g.toolPattern, input));
  const deny = hits.find((g) => g.decision === "deny");
  if (deny) return deny;
  return hits.find((g) => g.decision === "allow") ?? null;
}

/** Compact rule from a parked tool request. */
export function grantPatternFromToolRequest(input: {
  tool?: string | null;
  command?: string | null;
  title?: string | null;
}): string {
  const command = input.command?.trim();
  if (command) {
    const tokens = command.split(/\s+/).filter(Boolean);
    const prefix = tokens.slice(0, 2).join(" ");
    return `Bash(${prefix} *)`;
  }
  const klass = toolClassFromInput(input);
  if (klass === "edit") return "Edit";
  if (klass === "read") return "Read";
  if (klass === "grep") return "Grep";
  if (klass === "mcp") return "MCPTool";
  if (klass === "webfetch") return "WebFetch";
  if (klass === "websearch") return "WebSearch";
  return "Bash";
}

export function serializePermissionToml(
  grants: readonly RememberedGrant[],
): string {
  const allow = grants
    .filter((g) => g.decision === "allow")
    .map((g) => g.toolPattern);
  const deny = grants
    .filter((g) => g.decision === "deny")
    .map((g) => g.toolPattern);
  const lines = [
    `# Desk remembered grants (${deskPermissionFileName(DESK_PERMISSION_CLIENT)}).`,
    `# Scoped to one project; not shared with the Grok TUI permission.toml.`,
    "allow = [",
    ...allow.map((p) => `  ${JSON.stringify(p)},`),
    "]",
    "deny = [",
    ...deny.map((p) => `  ${JSON.stringify(p)},`),
    "]",
    "",
  ];
  return lines.join("\n");
}

function parseTomlStringArray(src: string, key: string): string[] {
  const re = new RegExp(`${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
  const m = src.match(re);
  if (!m) return [];
  const out: string[] = [];
  const body = m[1] ?? "";
  const item = /"((?:\\.|[^"\\])*)"/g;
  let hit: RegExpExecArray | null;
  while ((hit = item.exec(body))) {
    try {
      out.push(JSON.parse(`"${hit[1]}"`));
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export function parsePermissionToml(
  src: string,
  scopeRoot: string,
  now: string = new Date().toISOString(),
): RememberedGrant[] {
  const allow = parseTomlStringArray(src, "allow");
  const deny = parseTomlStringArray(src, "deny");
  const grants: RememberedGrant[] = [];
  let i = 0;
  for (const toolPattern of deny) {
    if (!parseCompactRule(toolPattern)) continue;
    grants.push({
      id: `deny-${i++}`,
      scopeRoot,
      toolPattern,
      decision: "deny",
      createdAt: now,
    });
  }
  i = 0;
  for (const toolPattern of allow) {
    if (!parseCompactRule(toolPattern)) continue;
    grants.push({
      id: `allow-${i++}`,
      scopeRoot,
      toolPattern,
      decision: "allow",
      createdAt: now,
    });
  }
  return grants;
}
