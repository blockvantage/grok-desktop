import { describe, it, expect } from "vitest";
import {
  openSettingsNavState,
  openToolsNavState,
  openAccountSettingsNavState,
} from "./open-settings-nav";

describe("openSettingsNavState", () => {
  it("defaults to account", () => {
    expect(openSettingsNavState()).toEqual({
      nav: "settings",
      settingsTab: "account",
    });
  });

  it("resolves aliases", () => {
    expect(openSettingsNavState("remote").settingsTab).toBe("advanced");
    expect(openSettingsNavState("language").settingsTab).toBe("preferences");
  });
});

describe("openToolsNavState / openAccountSettingsNavState", () => {
  it("targets tools and account", () => {
    expect(openToolsNavState()).toEqual({
      nav: "settings",
      settingsTab: "tools",
    });
    expect(openAccountSettingsNavState()).toEqual({
      nav: "settings",
      settingsTab: "account",
    });
  });
});
