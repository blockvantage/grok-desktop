/**
 * Pure post-`engine.run` terminal plan (Phase 6 residual extract from TaskRunner).
 * Decides whether to no-op, fail parked-waiting, or complete a still-running task.
 */
import {
  ENGINE_ENDED_WAITING_MESSAGE,
  isParkedWaitingStatus,
  terminalAfterEngineRun,
} from "./provider-gate-receipts.js";

export type PostEngineExitPlan =
  | { kind: "noop" }
  | {
      kind: "failed_waiting";
      errorMessage: string;
      attemptStatus: "failed";
      attemptReason: string;
    }
  | {
      kind: "complete_running";
      harvest: true;
      status: "done" | "failed";
      attemptReason: "engine_error" | "completed";
    };

/**
 * Plan side effects after the engine process returns (success path, not catch).
 */
export function planPostEngineExit(input: {
  /** Current task status after the engine finished; undefined if task gone. */
  status: string | undefined;
  sawError: boolean;
}): PostEngineExitPlan {
  if (!input.status || input.status === "cancelled") {
    return { kind: "noop" };
  }
  if (isParkedWaitingStatus(input.status)) {
    return {
      kind: "failed_waiting",
      errorMessage: ENGINE_ENDED_WAITING_MESSAGE,
      attemptStatus: "failed",
      attemptReason: "engine_ended_waiting_approval",
    };
  }
  if (input.status === "running") {
    const terminal = terminalAfterEngineRun(input.sawError);
    return {
      kind: "complete_running",
      harvest: true,
      status: terminal.status,
      attemptReason: terminal.reason,
    };
  }
  return { kind: "noop" };
}
