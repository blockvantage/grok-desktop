/**
 * Home landing surface budget — keep the composer primary; never stack
 * discovery + deliverables + stale lists at once.
 * Failed tasks are intentionally omitted from Home (retry lives in Chats).
 */

import type { WorkBoardItem, WorkBoardSnapshot } from "./concurrent-work-board";
import type { CapabilityHint } from "./capability-discovery";
import type { TaskRecipe } from "./task-recipes";
import type { ResumeIntent } from "./work-session";
import type { StaleTask } from "./stale-work";
import type { RecentDeliverable } from "./recent-deliverables";

export type LandingAttention = {
  /** Compact one-liner for a single banner. */
  title: string;
  /** Optional second line (one task title max). */
  detail: string | null;
  taskId: string | null;
  /** Total count represented. */
  count: number;
  kind: "needs_you" | "working" | "stuck";
};

export type HomeLandingPlan = {
  useBriefingAsSubtitle: boolean;
  attention: LandingAttention | null;
  /** Live items only (needs_you / working) — never a failed pile. */
  liveWorkItems: WorkBoardItem[];
  showLiveWork: boolean;
  /** Always false — resume strip removed from Home. */
  showResume: boolean;
  showRecipes: boolean;
  showDiscovery: boolean;
  showRecentDeliverables: boolean;
  /**
   * Smart-start recommended actions (max 3). Only when the desk is calm and
   * no other secondary strip is already offering next steps.
   */
  showSmartStarts: boolean;
  /** Cap for recommended next-action chips (recipes / smart starts). */
  maxRecommendedActions: number;
  recipes: TaskRecipe[];
  discovery: CapabilityHint[];
  recentDeliverables: RecentDeliverable[];
};

export type HomeLandingInput = {
  workBoard: WorkBoardSnapshot;
  resume: ResumeIntent;
  recipes: TaskRecipe[];
  discovery: CapabilityHint[];
  recentDeliverables: RecentDeliverable[];
  staleTasks: StaleTask[];
  /** Unread needs-you already shown in NoticeSlot. */
  hasNeedsYouNotice: boolean;
  hasRunningNotice: boolean;
};

/**
 * Decide which Home strips appear. Budget: at most one attention signal
 * beyond the top notice, plus at most one calm secondary
 * (recipes OR discovery OR deliverables OR smart starts — never stacked).
 * Cap recommended actions at 3. Failed tasks never surface here.
 */
export function planHomeLanding(input: HomeLandingInput): HomeLandingPlan {
  const liveWorkItems = input.workBoard.items
    .filter((i) => i.status === "needs_you" || i.status === "working")
    .slice(0, 3);

  const stuck = input.staleTasks
    .filter((s) => s.reason === "no_progress" || s.reason === "waiting_too_long")
    .slice(0, 1);

  let attention: LandingAttention | null = null;

  if (!input.hasNeedsYouNotice && input.workBoard.needsYouCount > 0) {
    const first = liveWorkItems.find((i) => i.status === "needs_you");
    attention = {
      kind: "needs_you",
      title:
        input.workBoard.needsYouCount === 1
          ? "1 task needs you"
          : `${input.workBoard.needsYouCount} tasks need you`,
      detail: first?.title ?? null,
      taskId: first?.taskId ?? null,
      count: input.workBoard.needsYouCount,
    };
  } else if (!input.hasRunningNotice && input.workBoard.workingCount > 0) {
    const first = liveWorkItems.find((i) => i.status === "working");
    attention = {
      kind: "working",
      title:
        input.workBoard.workingCount === 1
          ? "1 task is working"
          : `${input.workBoard.workingCount} tasks are working`,
      detail: first?.title ?? null,
      taskId: first?.taskId ?? null,
      count: input.workBoard.workingCount,
    };
  } else if (stuck[0]) {
    attention = {
      kind: "stuck",
      title: "1 task looks stuck",
      detail: stuck[0].title,
      taskId: stuck[0].taskId,
      count: 1,
    };
  }

  const deskIsBusy =
    input.hasNeedsYouNotice ||
    input.hasRunningNotice ||
    input.workBoard.needsYouCount > 0 ||
    input.workBoard.workingCount > 0 ||
    attention?.kind === "stuck";

  const showLiveWork =
    liveWorkItems.length > 0 &&
    // Don't double-stack if the top notice already covers running/needs-you.
    !(input.hasNeedsYouNotice && liveWorkItems.every((i) => i.status === "needs_you")) &&
    !(input.hasRunningNotice && liveWorkItems.every((i) => i.status === "working")) &&
    // When only one live item and attention already names it, skip the list.
    !(attention && liveWorkItems.length === 1 && attention.taskId === liveWorkItems[0]!.taskId);

  // Resume strip removed: draft continuity lives in the composer only.
  const showResume = false;

  // Calm-desk only secondaries — pick ONE: recipes > discovery > deliverables.
  // Smart starts fill the recommended-actions slot only when nothing else claims it.
  const maxRecommendedActions = 3;
  let showRecipes = false;
  let showDiscovery = false;
  let showRecentDeliverables = false;
  let showSmartStarts = false;
  const recipes = input.recipes.slice(0, maxRecommendedActions);
  const discovery = input.discovery.slice(0, 2);
  const recentDeliverables = input.recentDeliverables.slice(0, 3);

  if (!deskIsBusy) {
    // Exactly one calm secondary: recipes > discovery > deliverables > smart starts.
    if (recipes.length > 0) showRecipes = true;
    else if (discovery.length > 0) showDiscovery = true;
    else if (recentDeliverables.length > 0) showRecentDeliverables = true;
    else showSmartStarts = true;
  }

  const useBriefingAsSubtitle =
    attention == null ||
    attention.kind === "needs_you" ||
    attention.kind === "working" ||
    attention.kind === "stuck";

  return {
    useBriefingAsSubtitle,
    attention,
    liveWorkItems,
    showLiveWork,
    showResume,
    showRecipes,
    showDiscovery,
    showRecentDeliverables,
    showSmartStarts,
    maxRecommendedActions,
    recipes,
    discovery,
    recentDeliverables,
  };
}
