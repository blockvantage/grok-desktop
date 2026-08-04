import { describe, expect, it } from "vitest";
import { resolveSettingsTab } from "./settings-tab";

describe("resolveSettingsTab", () => {
  it("aliases language to preferences and license/remote to advanced", () => {
    expect(resolveSettingsTab("language")).toBe("preferences");
    expect(resolveSettingsTab("license")).toBe("advanced");
    expect(resolveSettingsTab("remote")).toBe("advanced");
    expect(resolveSettingsTab("tools")).toBe("tools");
    expect(resolveSettingsTab("nope")).toBe("account");
  });
});
