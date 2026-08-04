/**
 * Pure helpers for task event stream presentation.
 * Kept separate so unit tests drive the real shipped mapping.
 */

import { t } from "@/i18n/active";

export type EventRowIconStatus =
  | "done"
  | "failed"
  | "running"
  | "waiting_approval"
  | "queued";

export type EmptyStreamCopy = {
  title: string;
  description: string;
  /** When true, empty state shows a spinner icon */
  spinning: boolean;
};

/** Queued work has not started; only a running engine is actively working. */
export function isTaskActivelyWorking(
  status: string | null | undefined,
): boolean {
  return status === "running";
}

/**
 * Map a task event row to an icon status for StatusIcon.
 * Steps use payload.status: start → running, end → done.
 */
export function eventRowIconStatus(
  kind: string,
  payload: Record<string, unknown> = {},
): EventRowIconStatus {
  if (kind === "error") return "failed";
  if (kind === "approval_required") return "waiting_approval";
  if (kind === "step") {
    const stepStatus = String(payload.status ?? "").toLowerCase();
    if (stepStatus === "end" || stepStatus === "completed" || stepStatus === "done") {
      return "done";
    }
    return "running";
  }
  if (kind === "artifact_created" || kind === "approval_resolved") {
    return "done";
  }
  if (kind === "tool_result") {
    if (payload.ok === false) return "failed";
    return "done";
  }
  if (kind === "tool_request") return "running";
  if (kind === "status_change") {
    const st = String(payload.status ?? "").toLowerCase();
    if (st === "done" || st === "cancelled") return "done";
    if (st === "failed") return "failed";
    if (st === "waiting_approval" || st === "waiting_user") {
      return "waiting_approval";
    }
    if (st === "running") return "running";
  }
  return "queued";
}

/**
 * Empty stream copy depends on the selected task's lifecycle status,
 * not a permanent "Working" spinner.
 */
export function emptyStreamCopy(taskStatus: string | null | undefined): EmptyStreamCopy {
  const st = (taskStatus ?? "queued").toLowerCase();
  if (st === "queued") {
    return {
      title: t("status.queued"),
      description: t("workspace.queuedDesc"),
      spinning: false,
    };
  }
  if (st === "running") {
    return {
      title: t("workspace.emptyTitle"),
      description: t("workspace.emptyDesc"),
      spinning: true,
    };
  }
  if (st === "waiting_approval" || st === "waiting_user") {
    return {
      title: t("workspace.waitingTitle"),
      description: t("workspace.waitingDesc"),
      spinning: false,
    };
  }
  if (st === "failed") {
    return {
      title: t("workspace.failedTitle"),
      description: t("workspace.failedDesc"),
      spinning: false,
    };
  }
  if (st === "cancelled") {
    return {
      title: t("workspace.cancelledTitle"),
      description: t("workspace.cancelledDesc"),
      spinning: false,
    };
  }
  return {
    title: t("workspace.noEventsTitle"),
    description: t("workspace.noEventsDesc"),
    spinning: false,
  };
}
