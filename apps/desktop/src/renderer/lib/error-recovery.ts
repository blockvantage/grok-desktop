import type { RecoveryKind } from "@grokdesk/shared";
import { classifyEngineError } from "@grokdesk/shared";

export type RecoveryAction =
  | "openBilling"
  | "openUsage"
  | "signIn"
  | "retry"
  | "dismiss";

export interface RecoveryViewModel {
  kind: RecoveryKind;
  title: string;
  body: string;
  primary?: { label: string; action: RecoveryAction };
  secondary?: { label: string; action: RecoveryAction };
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Map engine error message → recovery UI model (i18n keys via t). */
export function recoveryFromErrorMessage(
  message: string,
  t: Translate = (k) => k,
): RecoveryViewModel {
  const { kind } = classifyEngineError(message);
  switch (kind) {
    case "usage_exhausted":
      return {
        kind,
        title: t("recovery.usageExhaustedTitle"),
        body: t("recovery.usageExhaustedBody"),
        primary: { label: t("recovery.manageBilling"), action: "openBilling" },
        secondary: { label: t("recovery.viewUsage"), action: "openUsage" },
      };
    case "usage_limit":
      return {
        kind,
        title: t("recovery.usageLimitTitle"),
        body: t("recovery.usageLimitBody"),
        primary: { label: t("recovery.manageBilling"), action: "openBilling" },
        secondary: { label: t("recovery.viewUsage"), action: "openUsage" },
      };
    case "rate_limited":
      return {
        kind,
        title: t("recovery.rateLimitedTitle"),
        body: t("recovery.rateLimitedBody"),
        primary: { label: t("recovery.dismiss"), action: "dismiss" },
      };
    case "needs_reauth":
      return {
        kind,
        title: t("recovery.reauthTitle"),
        body: t("recovery.reauthBody"),
        primary: { label: t("recovery.signIn"), action: "signIn" },
      };
    case "context_pressure":
      return {
        kind,
        title: t("recovery.contextTitle"),
        body: t("recovery.contextBody"),
        primary: { label: t("recovery.dismiss"), action: "dismiss" },
      };
    default:
      return {
        kind: "generic",
        title: t("recovery.genericTitle"),
        body: message.slice(0, 280) || t("common.error"),
        // Retry re-submits (smart-retry goal) and clears the failed state, so
        // the banner self-dismisses — no dead-end no-op "Dismiss" button.
        primary: { label: t("recovery.retry"), action: "retry" },
      };
  }
}
