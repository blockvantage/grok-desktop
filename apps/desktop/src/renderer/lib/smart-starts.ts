/**
 * Contextual smart-start cards for Home.
 * Rank by role pack + workspace so the first things users see match how they work.
 */

export type SmartStartId =
  | "brief"
  | "organize"
  | "plan"
  | "visual"
  | "research"
  | "weekly"
  | "inbox"
  | "continue";

export type SmartStartDef = {
  id: SmartStartId;
  icon: "pen" | "folder" | "sparkles" | "image" | "search" | "calendar" | "inbox" | "play";
  labelKey: string;
  descKey: string;
  goalKey: string;
  /** Prefer when this role pack is selected */
  packs?: string[];
  /** Prefer when a workspace folder is set */
  needsWorkspace?: boolean;
  /** Prefer when there is a recent incomplete / done task to continue */
  needsRecentTask?: boolean;
};

export const SMART_START_CATALOG: SmartStartDef[] = [
  {
    id: "brief",
    icon: "pen",
    labelKey: "home.ideaBrief",
    descKey: "home.ideaBriefDesc",
    // SC-7: shared with slash.briefGoal (one template per intent).
    goalKey: "slash.briefGoal",
    packs: ["marketing", "chief-of-staff"],
  },
  {
    id: "organize",
    icon: "folder",
    labelKey: "home.ideaOrganize",
    descKey: "home.ideaOrganizeDesc",
    goalKey: "slash.organizeGoal",
    packs: ["ops"],
    needsWorkspace: true,
  },
  {
    id: "plan",
    icon: "sparkles",
    labelKey: "home.ideaPlan",
    descKey: "home.ideaPlanDesc",
    goalKey: "home.ideaPlanGoal",
    packs: ["chief-of-staff", "ops"],
  },
  {
    id: "visual",
    icon: "image",
    labelKey: "home.ideaVisual",
    descKey: "home.ideaVisualDesc",
    goalKey: "slash.imageGoal",
    packs: ["marketing"],
  },
  {
    id: "research",
    icon: "search",
    labelKey: "home.ideaResearch",
    descKey: "home.ideaResearchDesc",
    goalKey: "slash.researchGoal",
    packs: ["research", "marketing"],
  },
  {
    id: "weekly",
    icon: "calendar",
    labelKey: "home.ideaWeekly",
    descKey: "home.ideaWeeklyDesc",
    goalKey: "home.ideaWeeklyGoal",
    packs: ["chief-of-staff"],
  },
  {
    id: "continue",
    icon: "play",
    labelKey: "home.ideaContinue",
    descKey: "home.ideaContinueDesc",
    goalKey: "home.ideaContinueGoal",
    needsRecentTask: true,
  },
];

export function scoreSmartStart(
  def: SmartStartDef,
  ctx: {
    rolePackId: string | null;
    hasWorkspace: boolean;
    hasRecentTask: boolean;
  },
): number {
  let score = 0;
  if (def.packs?.length && ctx.rolePackId && def.packs.includes(ctx.rolePackId)) {
    score += 10;
  }
  if (def.needsWorkspace) {
    score += ctx.hasWorkspace ? 6 : -8;
  }
  if (def.needsRecentTask) {
    score += ctx.hasRecentTask ? 12 : -20;
  }
  // Stable baseline so catalog order still matters when ties.
  score += SMART_START_CATALOG.findIndex((d) => d.id === def.id) * -0.01;
  return score;
}

/** Top N smart starts for the current context (default 4 cards). */
export function pickSmartStarts(
  ctx: {
    rolePackId: string | null;
    hasWorkspace: boolean;
    hasRecentTask: boolean;
  },
  limit = 4,
): SmartStartDef[] {
  return [...SMART_START_CATALOG]
    .map((def) => ({ def, score: scoreSmartStart(def, ctx) }))
    .filter((x) => x.score > -15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.def);
}
