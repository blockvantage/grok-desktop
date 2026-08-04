/**
 * Pure toast mapping for chat export outcomes (Phase 6 extract).
 */

export type ExportToastIntent =
  | { kind: "success"; path: string }
  | { kind: "error"; message: string };

/**
 * Map a successful export path to a success intent.
 */
export function exportChatSuccessIntent(path: string): ExportToastIntent {
  return { kind: "success", path };
}

/**
 * Map an unknown error to a destructive toast message.
 */
export function exportChatErrorIntent(
  err: unknown,
  fallbackMessage: string,
): ExportToastIntent {
  const message =
    err instanceof Error && err.message ? err.message : fallbackMessage;
  return { kind: "error", message };
}

/**
 * Default imagine goal template for a task goal.
 */
export function imagineGoalFromTask(goal: string): string {
  return `Generate an image that illustrates: ${goal}. Save under ./artifacts.`;
}
