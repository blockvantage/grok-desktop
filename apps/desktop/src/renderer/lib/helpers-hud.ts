/**
 * C4: Helpers HUD — real worker events only (never parentTaskId).
 * Re-exports + thin binder over subagent-hud builders.
 */
import {
  buildSubagentHud,
  buildSubagentHudFromWorkers,
  isLikelySubagent,
  type SubagentHud,
} from "./subagent-hud";
import type { WorkerRecord } from "./activity-store";

export type HelpersHudView = SubagentHud;

/**
 * Build helpers row. Empty/null when no truthful workers.
 * parentTaskId siblings alone must never produce items (G3).
 */
export function projectHelpersHud(input: {
  workers?: WorkerRecord[] | null;
  /** When false, hide (headless-degraded). */
  workersAvailable?: boolean;
}): HelpersHudView | null {
  if (input.workersAvailable === false) return null;
  if (!input.workers?.length) return null;
  return buildSubagentHudFromWorkers(input.workers);
}

/** Characterization: parentTaskId is never a worker signal. */
export function parentTaskIdNeverImpliesHelper(): boolean {
  return (
    isLikelySubagent(
      { id: "child", parentTaskId: "root", status: "running", title: null, goal: "x" },
      [
        { id: "root", parentTaskId: null, status: "running", title: null, goal: "y" },
        { id: "child", parentTaskId: "root", status: "running", title: null, goal: "x" },
      ],
    ) === false
  );
}

export { buildSubagentHud, buildSubagentHudFromWorkers, isLikelySubagent };
