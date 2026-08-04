/**
 * Degraded / limited-mode labeling (I6).
 *
 * Headless path is event-poor; ACP is preferred. When a run is degraded,
 * show **one** session-level label — never per-tool spam.
 */

export type SessionTransportMode = "acp" | "headless" | "unknown";

export type DegradedModeProjection = {
  /** True when UI should show the limited-mode chip/banner once. */
  showLimitedLabel: boolean;
  /** i18n key for the single label. */
  labelKey: string;
  /** i18n key for optional short detail (resume failures, etc.). */
  detailKey: string | null;
  transport: SessionTransportMode;
  /** Machine reason for diagnostics. */
  reason: string | null;
};

export type DegradedModeInput = {
  /** Preferred ACP when true and available. */
  preferAcp?: boolean;
  /** Probe/runtime reports agent stdio / ACP available. */
  acpAvailable?: boolean;
  /** Actual mode used for this run. */
  transport?: SessionTransportMode;
  /** Provider preflight marked degraded. */
  providerDegraded?: boolean;
  providerDegradedReason?: string | null;
  /** Resume failed and fell back to transcript-only / fresh session. */
  resumeFailed?: boolean;
  resumeFailureReason?: string | null;
};

/**
 * Project a single limited-mode label for the open run.
 * Returns showLimitedLabel=false when full ACP mediation is in use.
 */
export function projectDegradedMode(
  input: DegradedModeInput,
): DegradedModeProjection {
  const transport: SessionTransportMode =
    input.transport ??
    (input.acpAvailable && input.preferAcp !== false
      ? "acp"
      : input.acpAvailable === false
        ? "headless"
        : "unknown");

  if (input.resumeFailed) {
    return {
      showLimitedLabel: true,
      labelKey: "degraded.resumeFallback",
      detailKey: "degraded.resumeFallbackDetail",
      transport,
      reason: input.resumeFailureReason ?? "resume_failed",
    };
  }

  if (input.providerDegraded) {
    return {
      showLimitedLabel: true,
      labelKey: "degraded.limitedMode",
      detailKey: "degraded.providerPartial",
      transport,
      reason: input.providerDegradedReason ?? "provider_degraded",
    };
  }

  if (transport === "headless") {
    return {
      showLimitedLabel: true,
      labelKey: "degraded.limitedMode",
      detailKey: "degraded.headlessDetail",
      transport: "headless",
      reason: "headless",
    };
  }

  if (transport === "unknown" && input.acpAvailable === false) {
    return {
      showLimitedLabel: true,
      labelKey: "degraded.limitedMode",
      detailKey: "degraded.headlessDetail",
      transport: "headless",
      reason: "acp_unavailable",
    };
  }

  return {
    showLimitedLabel: false,
    labelKey: "degraded.fullMode",
    detailKey: null,
    transport: transport === "unknown" ? "acp" : transport,
    reason: null,
  };
}
