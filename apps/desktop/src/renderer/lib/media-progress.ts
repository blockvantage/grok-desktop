/**
 * Media-aware live progress (PROG-2).
 * Detect image/video generation tools so the stream can show a placeholder card.
 */

export type MediaToolKind = "video" | "image";

/**
 * Tool-name tokens that mean "read / inspect / move" rather than "generate".
 * A tool whose name contains any of these never triggers a rendering card,
 * even if it also mentions image/video (e.g. `view_image`, `download_video`).
 */
const NON_GENERATION_TOKENS = new Set([
  "read",
  "view",
  "open",
  "list",
  "get",
  "download",
  "fetch",
  "show",
  "display",
  "search",
  "find",
  "load",
  "save",
  "upload",
  "delete",
  "remove",
  "convert",
]);

/** Map a tool name to a media generation kind, or null if not media. */
export function mediaToolKind(
  tool: string | null | undefined,
): MediaToolKind | null {
  if (!tool) return null;
  const t = tool.toLowerCase();
  // Reject inspection/transport tools that merely mention a media word.
  const tokens = t.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((tok) => NON_GENERATION_TOKENS.has(tok))) return null;
  if (t.includes("video")) return "video";
  if (t.includes("image") || t.includes("imagine")) return "image";
  return null;
}

export type RunningToolLike = {
  tool: string;
  status: "running" | "ok" | "failed";
  detail?: string;
};

/**
 * Newest running media tool kind from a tool-action list (newest last).
 * Returns null when no running media tool is open.
 */
export function runningMediaKind(
  tools: readonly RunningToolLike[],
): MediaToolKind | null {
  for (let i = tools.length - 1; i >= 0; i--) {
    const row = tools[i]!;
    if (row.status !== "running") continue;
    const kind = mediaToolKind(row.tool);
    if (kind) return kind;
  }
  return null;
}

/**
 * Open (unmatched) tool_request rows from a conversation work log, newest last.
 * Used by the conversation LiveWorkCard path (primary chat surface).
 */
export function openToolsFromWork(
  work: readonly {
    kind: string;
    payload: Record<string, unknown>;
    summary?: string;
  }[],
): RunningToolLike[] {
  const open: RunningToolLike[] = [];
  for (const entry of work) {
    if (entry.kind === "tool_request") {
      const fromPayload = String(entry.payload.tool ?? "").trim();
      // Prefer payload.tool; fall back to summary only when it looks like a name.
      const tool =
        fromPayload ||
        (entry.summary && !entry.summary.includes(" ")
          ? entry.summary.trim()
          : "") ||
        "tool";
      const detail =
        typeof entry.payload.path === "string"
          ? entry.payload.path
          : typeof entry.payload.command === "string"
            ? entry.payload.command
            : entry.summary;
      open.push({ tool, status: "running", detail });
      continue;
    }
    if (entry.kind === "tool_result" && open.length > 0) {
      const tool = String(entry.payload.tool ?? "").trim();
      for (let i = open.length - 1; i >= 0; i--) {
        if (!tool || open[i]!.tool === tool) {
          open.splice(i, 1);
          break;
        }
      }
    }
  }
  return open;
}
