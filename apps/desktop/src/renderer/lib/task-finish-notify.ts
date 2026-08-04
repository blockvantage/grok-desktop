/**
 * Pure helpers for App background completion notifications (Phase 6 residual).
 */

export type FinishNotifyTask = {
  status: string;
  goal: string;
};

export type FinishNotifyIntent = {
  /** i18n key for Notification title */
  titleKey: "toast.taskComplete" | "toast.taskFailed";
  body: string;
};

/**
 * Whether OS notifications should fire for newly finished tasks.
 * Requires Notification API and an unfocused document (user is away).
 */
export function shouldFireFinishNotifications(input: {
  finishedCount: number;
  notificationAvailable: boolean;
  documentHasFocus: boolean;
}): boolean {
  return (
    input.finishedCount > 0 &&
    input.notificationAvailable &&
    !input.documentHasFocus
  );
}

/**
 * Map finished tasks to notification intents (title key + body).
 * Does not construct Notification objects — App owns the side effect.
 */
export function finishNotificationIntents(
  finished: ReadonlyArray<FinishNotifyTask>,
): FinishNotifyIntent[] {
  return finished.map((task) => ({
    titleKey:
      task.status === "done" ? "toast.taskComplete" : "toast.taskFailed",
    body: task.goal,
  }));
}
