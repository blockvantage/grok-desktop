/**
 * Pure presentation model for event-history recovery states (Task 11 / AC4).
 * Cached events stay visible; this only decides what recovery chrome to show.
 */

export type EventHistoryStatusInput = {
  error: string | null | undefined;
  staleSince: string | null | undefined;
  truncated: boolean | undefined;
  loading?: boolean;
};

export type EventHistoryBannerKind = "stale" | "truncated" | "none";

export type EventHistoryBanner = {
  kind: EventHistoryBannerKind;
  /** i18n key under workspace.* */
  messageKey: string;
  showRetry: boolean;
  /** data-testid for structural / a11y tests */
  testId: string;
};

/**
 * Prefer stale/error over truncated when both apply so the user gets a
 * recoverable action first.
 */
export function planEventHistoryBanner(
  input: EventHistoryStatusInput,
): EventHistoryBanner {
  if (input.loading) {
    return {
      kind: "none",
      messageKey: "",
      showRetry: false,
      testId: "event-history-ok",
    };
  }
  if (input.error || input.staleSince) {
    return {
      kind: "stale",
      messageKey: "workspace.eventsStale",
      showRetry: true,
      testId: "event-history-stale",
    };
  }
  if (input.truncated) {
    return {
      kind: "truncated",
      messageKey: "workspace.eventsTruncated",
      showRetry: true,
      testId: "event-history-truncated",
    };
  }
  return {
    kind: "none",
    messageKey: "",
    showRetry: false,
    testId: "event-history-ok",
  };
}
