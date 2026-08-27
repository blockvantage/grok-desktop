/**
 * Pure tray status derivation from the waiting-on-you projector (Phase 1.4).
 */
import {
  emptyWaitingOnYou,
  projectWaitingOnYou,
  type Task,
  type TrayStatus,
  type WaitingOnYouView,
} from "@grokdesk/shared";

export type TrayStatusView = {
  status: TrayStatus;
  runningCount: number;
  /** Locale-free objective — progress for the dock tooltip. */
  progressLine?: string | null;
} & WaitingOnYouView;

export function computeTrayStatus(
  tasks: readonly Task[],
  paused: boolean,
  extras?: { progressLine?: string | null },
): TrayStatusView {
  const waiting = projectWaitingOnYou({ tasks: [...tasks] });
  const progressLine = extras?.progressLine ?? null;
  if (paused) {
    return {
      status: "paused",
      runningCount: 0,
      progressLine,
      ...emptyWaitingOnYou(),
    };
  }
  const running = tasks.filter((t) => t.status === "running").length;
  if (waiting.needsInput) {
    return {
      status: "needs_you",
      runningCount: running,
      progressLine,
      ...waiting,
    };
  }
  if (running > 0) {
    return {
      status: "working",
      runningCount: running,
      progressLine,
      ...waiting,
    };
  }
  return { status: "idle", runningCount: running, progressLine, ...waiting };
}
