/**
 * Parse proactivity suggestion bodies into schedule.create payloads.
 *
 * Proactivity writes free-text drafts like:
 *   Draft schedule: Weekly priority review (0 9 * * 1)
 *   Goal: Review standing priorities and open loops.
 */

export type SuggestionDraftSchedule = {
  name: string;
  cron: string;
  goalTemplate: string;
};

export type ScheduleCreateParams = {
  name: string;
  goalTemplate: string;
  cron: string;
  timezone: string;
  approvalMode: "strict" | "balanced" | "autopilot";
  model: string;
  effort: "fast" | "normal" | "heavy" | "max";
  workspaceRoots: string[];
  rolePack?: string | null;
  quietHoursRespect: boolean;
};

/**
 * Extract draft schedule fields from an inbox suggestion body.
 * Returns null when the body is not a schedule-suggestion draft.
 */
export function parseSuggestionDraftSchedule(
  body: string,
): SuggestionDraftSchedule | null {
  if (!body?.trim()) return null;
  const scheduleLine = body.match(
    /Draft schedule:\s*(.+?)\s*\(([^)]+)\)\s*$/m,
  );
  const goalLine = body.match(/^Goal:\s*(.+)$/m);
  if (!scheduleLine || !goalLine) return null;
  const name = scheduleLine[1]!.trim();
  const cron = scheduleLine[2]!.trim();
  const goalTemplate = goalLine[1]!.trim();
  if (!name || !cron || !goalTemplate) return null;
  return { name, cron, goalTemplate };
}

/**
 * Build schedule.create RPC params from a parsed draft + UI options.
 */
export function buildScheduleCreateFromDraft(
  draft: SuggestionDraftSchedule,
  opts: {
    workspaceRoots: string[];
    timezone?: string;
    approvalMode?: "strict" | "balanced" | "autopilot";
    model?: string;
    effort?: "fast" | "normal" | "heavy" | "max";
    rolePack?: string | null;
    quietHoursRespect?: boolean;
  },
): ScheduleCreateParams {
  return {
    name: draft.name,
    goalTemplate: draft.goalTemplate,
    cron: draft.cron,
    timezone:
      opts.timezone ??
      (typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        : "UTC"),
    approvalMode: opts.approvalMode ?? "balanced",
    model: opts.model ?? "grok-4.5",
    effort: opts.effort ?? "normal",
    workspaceRoots: opts.workspaceRoots,
    rolePack: opts.rolePack ?? null,
    quietHoursRespect: opts.quietHoursRespect ?? true,
  };
}
