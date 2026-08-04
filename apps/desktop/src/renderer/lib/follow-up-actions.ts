/**
 * One-click next actions after a task finishes.
 * Zero settings — chips appear by default when the turn is terminal.
 */

export type FollowUpActionId =
  | "summarize"
  | "takeaways"
  | "schedule"
  | "imagine"
  | "openFiles"
  | "retry"
  | "elaborate"
  | "saveRecipe"
  | "copyAnswer"
  | "exportPack";

export type FollowUpAction = {
  id: FollowUpActionId;
  labelKey: string;
  /** When set, fills the follow-up composer with this i18n key's text */
  goalKey?: string;
  /** Handler kind for the view layer */
  kind:
    | "followUp"
    | "takeaways"
    | "imagine"
    | "openFiles"
    | "schedule"
    | "saveRecipe"
    | "copyAnswer"
    | "exportPack";
  /** Show only for these terminal statuses (default: done) */
  statuses?: Array<"done" | "failed" | "cancelled">;
  /** Prefer when deliverables exist */
  needsArtifacts?: boolean;
};

export const FOLLOW_UP_ACTIONS: FollowUpAction[] = [
  {
    id: "summarize",
    labelKey: "workspace.nextSummarize",
    goalKey: "workspace.nextSummarizeGoal",
    kind: "followUp",
    statuses: ["done"],
  },
  {
    id: "openFiles",
    labelKey: "workspace.nextOpenFiles",
    kind: "openFiles",
    statuses: ["done"],
    needsArtifacts: true,
  },
  {
    id: "elaborate",
    labelKey: "workspace.nextElaborate",
    goalKey: "workspace.nextElaborateGoal",
    kind: "followUp",
    statuses: ["done"],
  },
  {
    id: "takeaways",
    labelKey: "workspace.nextTakeaways",
    kind: "takeaways",
    statuses: ["done"],
  },
  {
    id: "schedule",
    labelKey: "workspace.nextSchedule",
    kind: "schedule",
    statuses: ["done"],
  },
  {
    id: "imagine",
    labelKey: "workspace.nextImagine",
    kind: "imagine",
    statuses: ["done"],
  },
  {
    id: "retry",
    labelKey: "workspace.nextRetry",
    goalKey: "workspace.nextRetryGoal",
    kind: "followUp",
    statuses: ["failed", "cancelled"],
  },
  {
    id: "saveRecipe",
    labelKey: "workspace.nextSaveRecipe",
    kind: "saveRecipe",
    statuses: ["done"],
  },
  {
    id: "copyAnswer",
    labelKey: "workspace.nextCopyAnswer",
    kind: "copyAnswer",
    statuses: ["done"],
  },
  {
    id: "exportPack",
    labelKey: "workspace.nextExportPack",
    kind: "exportPack",
    statuses: ["done"],
  },
];

export function pickFollowUpActions(opts: {
  status: string;
  hasArtifacts: boolean;
  limit?: number;
}): FollowUpAction[] {
  const st = opts.status as "done" | "failed" | "cancelled";
  const limit = opts.limit ?? 8;
  return FOLLOW_UP_ACTIONS.filter((a) => {
    const allowed = a.statuses ?? ["done"];
    if (!allowed.includes(st)) return false;
    if (a.needsArtifacts && !opts.hasArtifacts) return false;
    return true;
  }).slice(0, limit);
}
