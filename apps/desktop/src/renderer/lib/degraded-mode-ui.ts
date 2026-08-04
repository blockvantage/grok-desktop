/**
 * Desktop binding for I6 single limited-mode label.
 */
import {
  projectDegradedMode,
  type DegradedModeInput,
  type DegradedModeProjection,
} from "@grokdesk/shared";

export type DegradedModeView = DegradedModeProjection;

export function projectDegradedModeView(
  input: DegradedModeInput,
): DegradedModeView {
  return projectDegradedMode(input);
}

/**
 * Infer transport from provider health version string used in the app.
 */
export function transportFromProviderVersion(
  version: string | null | undefined,
): DegradedModeInput["transport"] {
  if (!version) return "unknown";
  if (version.includes("acp")) return "acp";
  if (version.includes("headless")) return "headless";
  return "unknown";
}
