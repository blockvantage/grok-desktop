import { describe, it, expect } from "vitest";
import { appSettingsFromSettingsGet } from "./app-settings-slice";

describe("appSettingsFromSettingsGet", () => {
  it("defaults empty arrays", () => {
    expect(appSettingsFromSettingsGet({})).toEqual({
      mcpServers: [],
      skillsPaths: [],
      effectiveSkillsPaths: [],
      preferProviderEngine: false,
      inheritUserGrok: false,
      trustedFolders: [],
    });
  });

  it("passes through provided fields", () => {
    const mcp = [
      { id: "x", command: "npx", args: [], enabled: true },
    ];
    expect(
      appSettingsFromSettingsGet({
        mcpServers: mcp,
        skillsPaths: ["/s"],
        effectiveSkillsPaths: ["/e"],
        preferProviderEngine: true,
        inheritUserGrok: true,
        trustedFolders: ["/ws"],
      }),
    ).toEqual({
      mcpServers: mcp,
      skillsPaths: ["/s"],
      effectiveSkillsPaths: ["/e"],
      preferProviderEngine: true,
      inheritUserGrok: true,
      trustedFolders: ["/ws"],
    });
  });
});
