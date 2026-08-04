/**
 * C2: file-level Review changes from edit/write tool events + artifacts.
 * Empty when no file-change signals (fail closed — no invent).
 */

export type ReviewChangeFile = {
  path: string;
  /** write | edit | delete | unknown */
  action: "write" | "edit" | "delete" | "unknown";
  tool?: string;
};

export type ReviewChangesView = {
  files: ReviewChangeFile[];
  /** Product strip title key */
  titleKey: string;
};

export type ReviewEventLike = {
  kind: string;
  payload?: Record<string, unknown> | null;
};

const WRITE_TOOLS = /write|edit|apply_patch|create_file|delete|rename/i;

/**
 * Apply Keep (accept) / Undo resolution to a projected file list.
 * Pure helper used by workspace state + tests.
 */
export function applyReviewFileAction(
  view: ReviewChangesView,
  path: string,
  action: "keep" | "undo",
): ReviewChangesView | null {
  const next = view.files.filter((f) => f.path !== path);
  if (next.length === 0) return null;
  return { ...view, files: next };
  // action label reserved for audit; both remove from pending review strip
  void action;
}

/**
 * Collect unique file paths touched this turn from tool + artifact events.
 */
export function projectReviewChanges(
  events: readonly ReviewEventLike[],
): ReviewChangesView | null {
  const byPath = new Map<string, ReviewChangeFile>();

  for (const ev of events) {
    const p = ev.payload ?? {};
    if (ev.kind === "tool_request" || ev.kind === "tool_result") {
      const tool = String(
        p.tool ??
          (typeof p.tool === "object" && p.tool
            ? (p.tool as { tool?: string; name?: string }).tool ??
              (p.tool as { name?: string }).name
            : "") ??
          "",
      );
      const path =
        str(p.path) ||
        str((p.tool as { path?: string } | undefined)?.path) ||
        str(p.file_path) ||
        str(p.filePath);
      if (!path) continue;
      if (ev.kind === "tool_request" && tool && !WRITE_TOOLS.test(tool)) {
        // Only file-mutating tools for request; results may confirm
        if (!pathLooksLikeFile(path)) continue;
      }
      if (!pathLooksLikeFile(path) && !WRITE_TOOLS.test(tool)) continue;
      const action = classifyAction(tool, path);
      byPath.set(path, { path, action, tool: tool || undefined });
    }
    if (ev.kind === "artifact_created") {
      const path = str(p.path);
      if (path && pathLooksLikeFile(path)) {
        if (!byPath.has(path)) {
          byPath.set(path, { path, action: "write", tool: "artifact" });
        }
      }
    }
  }

  const files = [...byPath.values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  if (files.length === 0) return null;
  return { files, titleKey: "reviewChanges.title" };
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

function pathLooksLikeFile(p: string): boolean {
  // Avoid bare tool names
  return p.includes("/") || p.includes("\\") || /\.\w{1,8}$/.test(p);
}

function classifyAction(
  tool: string,
  _path: string,
): ReviewChangeFile["action"] {
  const t = tool.toLowerCase();
  if (/delete|rm|unlink/.test(t)) return "delete";
  if (/edit|patch|apply/.test(t)) return "edit";
  if (/write|create/.test(t)) return "write";
  return "unknown";
}
