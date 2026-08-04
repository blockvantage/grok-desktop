/**
 * Approval card projector (I4): every parked approval shows
 * **what** · **where** · **why it needs you** · once/always when available.
 *
 * Pure function over event payloads / tool request shapes used by gateway and UI.
 */

export type ApprovalScopeHint = "once" | "always" | "session" | null;

export type ApprovalCardProjection = {
  /** What the agent wants to do (human tool / action name). */
  what: string;
  /** Where (path, command, host, URL) — empty when unknown. */
  where: string;
  /** Why Desk is asking (reason from policy / broker). */
  why: string;
  /** Remembered grant scope when the payload advertises it. */
  scope: ApprovalScopeHint;
  /** Raw tool id for diagnostics (not primary UI). */
  toolId: string | null;
  /** Effect class for styling: shell | write | network | browser | desktop | other. */
  effectClass:
    | "shell"
    | "write"
    | "network"
    | "browser"
    | "desktop"
    | "plan"
    | "other";
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function firstNonEmpty(...vals: unknown[]): string {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return "";
}

function classifyTool(toolId: string, what: string): ApprovalCardProjection["effectClass"] {
  const t = `${toolId} ${what}`.toLowerCase();
  if (/\bplan\b|plan_first|plan-review/.test(t)) return "plan";
  if (
    /shell|bash|terminal|run_terminal|exec|command/.test(t)
  ) {
    return "shell";
  }
  if (/write|edit|apply_patch|create_file|delete|rename|fs_write/.test(t)) {
    return "write";
  }
  if (/web_search|web_fetch|http|network|fetch_url/.test(t)) return "network";
  if (/browser|navigate|click|screenshot|playwright/.test(t)) return "browser";
  if (/desktop|accessibility|mouse|keyboard|display/.test(t)) return "desktop";
  return "other";
}

function humanizeToolId(toolId: string): string {
  if (!toolId) return "Action";
  return toolId
    .replace(/^mcp__/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseScope(raw: unknown): ApprovalScopeHint {
  const s = str(raw).toLowerCase();
  if (s === "once" || s === "always" || s === "session") return s;
  if (raw === true) return "always";
  return null;
}

/**
 * Project an approval_required event payload (or tool request) into card fields.
 * Never dumps raw JSON into `what`/`where`/`why`.
 */
export function projectApprovalCard(
  payload: Record<string, unknown> | null | undefined,
): ApprovalCardProjection {
  const p = payload ?? {};
  const toolEv = asRecord(p.tool) ?? asRecord(p.request) ?? asRecord(p.toolRequest);
  const meta =
    asRecord(toolEv?.meta) ??
    asRecord(p.meta) ??
    asRecord(toolEv?.input) ??
    null;

  const toolId = firstNonEmpty(
    toolEv?.tool,
    toolEv?.name,
    toolEv?.toolName,
    p.toolName,
    typeof p.tool === "string" ? p.tool : "",
  );

  const what = firstNonEmpty(
    p.what,
    p.title,
    p.action,
    p.summary,
    toolEv?.title,
    toolEv?.description,
    humanizeToolId(toolId),
  );

  const where = firstNonEmpty(
    p.where,
    p.path,
    p.command,
    p.url,
    p.host,
    toolEv?.path,
    toolEv?.command,
    toolEv?.url,
    meta?.path,
    meta?.command,
    meta?.url,
    meta?.file_path,
    meta?.filePath,
    meta?.target,
  );

  const why = firstNonEmpty(
    p.why,
    p.reason,
    p.message,
    p.explanation,
    toolEv?.reason,
    // Default product copy key is resolved by UI; keep a stable English fallback.
    "Needs your approval before continuing",
  );

  const scope = parseScope(
    firstNonEmpty(p.scope, p.grantScope, p.remember, meta?.scope) ||
      p.always ||
      p.once,
  );

  return {
    what: what || "Action",
    where,
    why: why || "Needs your approval before continuing",
    scope,
    toolId: toolId || null,
    effectClass: classifyTool(toolId, what),
  };
}
