import { describe, it, expect } from "vitest";
import { defaultDesktopMachineSettings } from "./default-desktop-machine.js";

describe("defaultDesktopMachineSettings", () => {
  it("is disabled by default with safe budgets", () => {
    const m = defaultDesktopMachineSettings();
    expect(m.enabled).toBe(false);
    expect(m.maxActionsPerMinute).toBe(60);
    expect(m.maxActionsPerTask).toBe(2000);
    expect(m.screenshotFormat).toBe("jpeg");
  });
});
