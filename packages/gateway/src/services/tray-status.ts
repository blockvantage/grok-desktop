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
} & WaitingOnYouView;

export function computeTrayStatus(
  tasks: readonly Task[],
  paused: boolean,
): TrayStatusView {
  const waiting = projectWaitingOnYou({ tasks: [...tasks] });
  if (paused) {
    return { status: "paused", runningCount: 0, ...emptyWaitingOnYou() };
  }
  const running = tasks.filter((t) => t.status === "running").length;
  if (waiting.needsInput) {
    return { status: "needs_you", runningCount: running, ...waiting };
  }
  if (running > 0) {
    return { status: "working", runningCount: running, ...waiting };
  }
  return { status: "idle", runningCount: running, ...waiting };
}
