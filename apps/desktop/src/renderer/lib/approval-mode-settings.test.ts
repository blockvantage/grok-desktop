import { describe, it, expect } from "vitest";
import { approvalModeFromSettings } from "./approval-mode-settings";

describe("approvalModeFromSettings", () => {
  it("accepts known modes", () => {
    expect(approvalModeFromSettings("strict")).toBe("strict");
    expect(approvalModeFromSettings("balanced")).toBe("balanced");
    expect(approvalModeFromSettings("autopilot")).toBe("autopilot");
  });

  it("rejects unknown", () => {
    expect(approvalModeFromSettings("yolo")).toBeNull();
    expect(approvalModeFromSettings(1)).toBeNull();
    expect(approvalModeFromSettings(undefined)).toBeNull();
  });
});
