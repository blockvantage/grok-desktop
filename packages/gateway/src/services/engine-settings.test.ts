import { describe, it, expect } from "vitest";
import { engineSettingsChanged } from "./engine-settings.js";

type AppMcp = {
  id: string;
  command: string;
  args: string[];
  enabled: boolean;
};

describe("engineSettingsChanged", () => {
  const base = {
    mcpServers: [] as AppMcp[],
    skillsPaths: [] as string[],
    preferProviderEngine: false,
  };

  it("is false when nothing material changed", () => {
    expect(engineSettingsChanged(base, { ...base })).toBe(false);
    expect(
      engineSettingsChanged(base, {
        ...base,
        mcpServers: [],
        skillsPaths: [],
      }),
    ).toBe(false);
  });

  it("detects mcp enable, skills paths, and preferProviderEngine flips", () => {
    expect(
      engineSettingsChanged(base, {
        ...base,
        mcpServers: [
          { id: "filesystem", command: "npx", args: [], enabled: true },
        ],
      }),
    ).toBe(true);
    expect(
      engineSettingsChanged(base, {
        ...base,
        skillsPaths: ["/tmp/extra"],
      }),
    ).toBe(true);
    expect(
      engineSettingsChanged(base, {
        ...base,
        preferProviderEngine: true,
      }),
    ).toBe(true);
  });
});

