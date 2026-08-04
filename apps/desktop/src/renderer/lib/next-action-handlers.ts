/**
 * Pure resolution for post-run "What next?" chip side effects (Phase 6 extract).
 */

export type NextActionKind =
  | "followUp"
  | "takeaways"
  | "imagine"
  | "openFiles"
  | "schedule"
  | "saveRecipe"
  | "copyAnswer"
  | "exportPack";

export type NextActionLike = {
  kind: string;
  goalKey?: string;
  id?: string;
};

export type NextActionEffect =
  | { type: "followUp"; goalKey: string }
  | { type: "takeaways" }
  | { type: "imagine" }
  | { type: "openFiles"; firstPath: string | null }
  | { type: "schedule" }
  | { type: "saveRecipe" }
  | { type: "copyAnswer" }
  | { type: "exportPack" }
  | { type: "none" };

/**
 * Map a chip action + first deliverable path to a UI effect.
 */
export function resolveNextActionEffect(
  action: NextActionLike,
  firstArtifactPath: string | null | undefined,
): NextActionEffect {
  switch (action.kind) {
    case "followUp":
      return action.goalKey
        ? { type: "followUp", goalKey: action.goalKey }
        : { type: "none" };
    case "takeaways":
      return { type: "takeaways" };
    case "imagine":
      return { type: "imagine" };
    case "openFiles":
      return {
        type: "openFiles",
        firstPath: firstArtifactPath ?? null,
      };
    case "schedule":
      return { type: "schedule" };
    case "saveRecipe":
      return { type: "saveRecipe" };
    case "copyAnswer":
      return { type: "copyAnswer" };
    case "exportPack":
      return { type: "exportPack" };
    default:
      return { type: "none" };
  }
}

/**
 * First artifact path for openFiles chip, if any.
 */
export function firstArtifactPath(
  artifacts: Array<{ path?: string | null }>,
): string | null {
  const p = artifacts[0]?.path;
  return typeof p === "string" && p ? p : null;
}
