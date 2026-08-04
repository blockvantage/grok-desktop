import { describe, it, expect } from "vitest";
import { appSettingsAfterSave } from "./settings-saved-slice";

describe("appSettingsAfterSave", () => {
  const prior = {
    mcpServers: [{ id: "a" }],
    skillsPaths: ["/old"],
    effectiveSkillsPaths: ["/eff"],
    preferProviderEngine: false,
    inheritUserGrok: false,
    trustedFolders: [],
  };

  it("prefers saved fields and applied toast", () => {
    const r = appSettingsAfterSave({
      prior,
      next: { mcpServers: [], skillsPaths: ["/n"] },
      saved: {
        mcpServers: [{ id: "b" }],
        skillsPaths: ["/s"],
        effectiveSkillsPaths: ["/e2"],
        preferProviderEngine: true,
        inheritUserGrok: true,
        trustedFolders: ["/ws"],
        engineReloaded: true,
      },
    });
    expect(r.slice).toEqual({
      mcpServers: [{ id: "b" }],
      skillsPaths: ["/s"],
      effectiveSkillsPaths: ["/e2"],
      preferProviderEngine: true,
      inheritUserGrok: true,
      trustedFolders: ["/ws"],
    });
    expect(r.toastKey).toBe("settings.savedApplied");
  });

  it("falls back to next/prior and restart toast", () => {
    const r = appSettingsAfterSave({
      prior,
      next: {
        mcpServers: [{ id: "n" }],
        skillsPaths: ["/n"],
        preferProviderEngine: true,
        inheritUserGrok: true,
        trustedFolders: ["/a"],
      },
      saved: {},
    });
    expect(r.slice.mcpServers).toEqual([{ id: "n" }]);
    expect(r.slice.skillsPaths).toEqual(["/n"]);
    expect(r.slice.effectiveSkillsPaths).toEqual(["/eff"]);
    expect(r.slice.preferProviderEngine).toBe(true);
    expect(r.slice.inheritUserGrok).toBe(true);
    expect(r.slice.trustedFolders).toEqual(["/a"]);
    expect(r.toastKey).toBe("settings.savedRestart");
  });
});
