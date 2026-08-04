/**
 * Default desktop computer-use machine settings when SettingsService is absent
 * (tests / NullHostBridge path). Phase 6 extract from TaskRunner.runTask.
 */
import type { DesktopMachineSettings } from "@grokdesk/shared";

export function defaultDesktopMachineSettings(): DesktopMachineSettings {
  return {
    enabled: false,
    defaultDisplayId: null,
    maxActionsPerMinute: 60,
    maxActionsPerTask: 2000,
    maxScreenshotLongEdge: 1280,
    screenshotFormat: "jpeg",
    screenshotJpegQuality: 75,
  };
}
