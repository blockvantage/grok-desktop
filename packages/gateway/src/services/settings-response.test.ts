import { describe, it, expect } from "vitest";
import {
  buildSettingsGetResponse,
  buildSettingsMutateResponse,
} from "./settings-response.js";

describe("buildSettingsGetResponse", () => {
  it("redacts mcp servers and flattens for renderer back-compat", () => {
    const res = buildSettingsGetResponse({
      settings: {
        license: { key: "GD2.secret", activationSig: "secret-signature" },
        mcpServers: [
          {
            id: "x",
            command: "npx",
            args: [],
            env: { SECRET: "s3cr3t" },
            enabled: true,
          },
        ],
      },
      redactMcpServers: (servers) =>
        servers.map((s) => ({
          ...s,
          env: s.env ? Object.fromEntries(Object.keys(s.env).map((k) => [k, "[redacted]"])) : undefined,
        })),
      effectiveSkillsPaths: ["/skills"],
      bundled: { found: true, root: "/bundle", packs: ["a"] },
    });
    expect(res.effectiveSkillsPaths).toEqual(["/skills"]);
    expect(res.bundledSkillsFound).toBe(true);
    expect(res.bundledSkillsRoot).toBe("/bundle");
    const servers = (res.settings as { mcpServers: Array<{ env?: Record<string, string> }> })
      .mcpServers;
    expect(servers[0]!.env?.SECRET).toBe("[redacted]");
    // Flat back-compat also redacted
    expect(
      (res.mcpServers as Array<{ env?: Record<string, string> }>)[0]!.env
        ?.SECRET,
    ).toBe("[redacted]");
    expect(res).not.toHaveProperty("license");
    expect(res.settings).not.toHaveProperty("license");
  });
});

describe("buildSettingsMutateResponse", () => {
  it("includes engineReloaded and optional bundledSkillsFound", () => {
    const res = buildSettingsMutateResponse({
      settings: {
        maxConcurrentTasks: 2,
        license: { key: "GD2.secret", activationSig: "secret-signature" },
      },
      effectiveSkillsPaths: [],
      engineReloaded: true,
      bundledFound: false,
    });
    expect(res.engineReloaded).toBe(true);
    expect(res.bundledSkillsFound).toBe(false);
    expect(res.maxConcurrentTasks).toBe(2);
    expect(res).not.toHaveProperty("license");
    expect(res.settings).not.toHaveProperty("license");
  });
});
