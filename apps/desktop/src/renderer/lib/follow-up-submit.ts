/**
 * Pure follow-up composer submit decision (Phase 6 extract).
 */

export function isOptimisticTaskId(id: string): boolean {
  return id.startsWith("optimistic-");
}

export type FollowUpSubmitDecision =
  | { action: "noop" }
  | { action: "enqueue"; goal: string }
  | { action: "send"; goal: string };

/**
 * Decide whether to ignore, queue, or send a follow-up turn.
 *
 * `agentBusy` is true ONLY while the agent is actively producing a turn
 * (running/queued). It replaces the old "isLive" gate, which also queued while
 * the agent was merely awaiting the user (waiting_user) — that swallowed the
 * user's reply into a queue that never drained. Now: queue only while the agent
 * is actually busy; otherwise send straight through.
 */
export function resolveFollowUpSubmit(input: {
  goal: string;
  busy: boolean;
  optimistic: boolean;
  agentBusy: boolean;
}): FollowUpSubmitDecision {
  const g = input.goal.trim();
  if (!g || input.busy || input.optimistic) return { action: "noop" };
  if (input.agentBusy) return { action: "enqueue", goal: g };
  return { action: "send", goal: g };
}

export type DropPathResolver = (file: { path?: string }) => string | undefined;

/**
 * Native path for a dropped File. Electron 32+ removed File.path;
 * Desk exposes webUtils.getPathForFile on the preload bridge.
 */
export function nativePathForDropFile(
  file: { path?: string },
  getPathForFile?: DropPathResolver,
): string | undefined {
  if (typeof file.path === "string" && file.path.trim()) return file.path;
  const resolve =
    getPathForFile ??
    (typeof window !== "undefined"
      ? window.grokdesk?.getPathForFile
      : undefined);
  if (typeof resolve !== "function") return undefined;
  try {
    const p = resolve(file);
    return typeof p === "string" && p.trim() ? p : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract native file paths from a drag-and-drop FileList-like array.
 */
export function filePathsFromDropFiles(
  files: Array<{ path?: string }>,
  getPathForFile?: DropPathResolver,
): string[] {
  return files
    .map((f) => nativePathForDropFile(f, getPathForFile))
    .filter((p): p is string => typeof p === "string" && Boolean(p));
}

/**
 * Whether the follow-up send control should be disabled.
 */
export function isFollowUpSendDisabled(input: {
  goal: string;
  busy: boolean;
  optimistic: boolean;
}): boolean {
  return !input.goal.trim() || input.busy || input.optimistic;
}
