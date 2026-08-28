/**
 * Scheduled-run terminal → inbox (Phase 3.5 B1).
 * Quiet hours must not suppress these rows — they are outcomes, not nudges.
 */
import type { InboxItem, InboxKind, Task } from "@grokdesk/shared";

export type ScheduleOutcomeDraft = {
  kind: Extract<InboxKind, "schedule_done" | "unfinished">;
  title: string;
  body: string;
  taskId: string;
};

export function buildScheduleOutcomeInbox(input: {
  task: Pick<Task, "id" | "goal" | "status" | "scheduleRuleId" | "title">;
  scheduleName?: string | null;
  successHint?: string | null;
}): ScheduleOutcomeDraft | null {
  if (!input.task.scheduleRuleId) return null;
  const status = input.task.status;
  if (status !== "done" && status !== "failed" && status !== "cancelled") {
    return null;
  }
  const label =
    (input.scheduleName ?? "").trim() ||
    (input.task.title ?? "").trim() ||
    input.task.goal.trim().slice(0, 72) ||
    "Scheduled run";
  const hint = input.successHint?.trim();
  if (status === "done") {
    return {
      kind: "schedule_done",
      title: `${label} finished`,
      body: hint
        ? `${input.task.goal.slice(0, 200)}\nExpected: ${hint}`
        : input.task.goal.slice(0, 240),
      taskId: input.task.id,
    };
  }
  return {
    kind: "unfinished",
    title: `${label} ${status === "cancelled" ? "stopped" : "failed"}`,
    body: input.task.goal.slice(0, 240),
    taskId: input.task.id,
  };
}

export type ScheduleOutcomeWriter = {
  addDeduped: (input: {
    kind: InboxKind;
    title: string;
    body: string;
    taskId?: string | null;
  }) => InboxItem | null;
};

export function recordScheduleOutcome(
  inbox: ScheduleOutcomeWriter,
  input: Parameters<typeof buildScheduleOutcomeInbox>[0],
): InboxItem | null {
  const draft = buildScheduleOutcomeInbox(input);
  if (!draft) return null;
  return inbox.addDeduped(draft);
}
