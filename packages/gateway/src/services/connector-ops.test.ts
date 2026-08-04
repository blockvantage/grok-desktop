import { describe, it, expect, vi } from "vitest";
import {
  disableConnector,
  doctorConnectors,
  enableConnector,
  enableRecommendedConnectors,
  type ConnectorOpsDeps,
} from "./connector-ops.js";

function deps(over: Partial<ConnectorOpsDeps> = {}): ConnectorOpsDeps {
  const settings: ConnectorOpsDeps extends never ? never : {
    mcpServers: Array<{
      id: string;
      command: string;
      args: string[];
      env?: Record<string, string>;
      enabled: boolean;
    }>;
  } = {
    mcpServers: [
      {
        id: "s1",
        command: "npx",
        args: [],
        env: { KEY: "secret" },
        enabled: true,
      },
    ],
  };
  return {
    getAll: () => settings,
    enablePreset: vi.fn((_id, _env) => ({
      ...settings,
    })),
    disablePreset: vi.fn(() => ({ ...settings })),
    enableRecommended: vi.fn(() => ({ ...settings, recommended: true })),
    getEffectiveSkillsPaths: () => ["/skills"],
    applyEngineSettings: vi.fn(async () => true),
    doctorMcpServers: (servers) =>
      servers.map((s) => ({ id: s.id, ok: true, hasEnv: !!s.env })),
    ...over,
  };
}

describe("connector-ops", () => {
  it("enableConnector rebuilds engine and returns mutate shape", async () => {
    const d = deps();
    const r = await enableConnector(
      { presetId: "github", env: { TOKEN: "t" } },
      d,
    );
    expect(d.enablePreset).toHaveBeenCalledWith("github", { TOKEN: "t" });
    expect(d.applyEngineSettings).toHaveBeenCalled();
    expect(r.engineReloaded).toBe(true);
    expect(r.effectiveSkillsPaths).toEqual(["/skills"]);
  });

  it("disableConnector and enableRecommended wire applyEngineSettings", async () => {
    const d = deps({ applyEngineSettings: vi.fn(async () => false) });
    const off = await disableConnector("github", d);
    expect(off.engineReloaded).toBe(false);
    const rec = await enableRecommendedConnectors(d);
    expect(d.enableRecommended).toHaveBeenCalled();
    expect(rec.engineReloaded).toBe(false);
  });

  it("doctorConnectors filters by serverId and never exposes raw env", () => {
    const d = deps();
    const all = doctorConnectors(d);
    expect(all.reports).toHaveLength(1);
    const one = doctorConnectors(d, "s1");
    expect(one.reports).toHaveLength(1);
    const miss = doctorConnectors(d, "nope");
    expect(miss.reports).toHaveLength(0);
    // Reports must not include secret values from env
    expect(JSON.stringify(all.reports)).not.toContain("secret");
  });
});
