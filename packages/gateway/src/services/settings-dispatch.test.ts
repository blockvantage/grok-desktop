import { describe, it, expect, vi } from "vitest";
import {
  dispatchSettingsMethod,
  isSettingsMethod,
} from "./settings-dispatch.js";

describe("isSettingsMethod", () => {
  it("matches settings.get/set and vault ops", () => {
    expect(isSettingsMethod("settings.get")).toBe(true);
    expect(isSettingsMethod("settings.set")).toBe(true);
    expect(isSettingsMethod("settings.vault.scan")).toBe(true);
    expect(isSettingsMethod("settings.vault.migrate")).toBe(true);
    expect(isSettingsMethod("tasks.list")).toBe(false);
  });
});

describe("dispatchSettingsMethod", () => {
  it("get builds redacted response shape", async () => {
    const deps = {
      getAll: () =>
        ({
          mcpServers: [
            {
              id: "s1",
              command: "npx",
              args: [],
              env: { SECRET: "x" },
              enabled: true,
            },
          ],
        }) as never,
      getBundledSkillsInfo: () => ({ found: [] }),
      getEffectiveSkillsPaths: () => ["/skills"],
      set: vi.fn(),
      applyEngineSettings: vi.fn(),
    };
    const res = (await dispatchSettingsMethod(
      "settings.get",
      {},
      deps,
    )) as {
      mcpServers: Array<{ env?: Record<string, string> }>;
      effectiveSkillsPaths: string[];
    };
    expect(res.effectiveSkillsPaths).toEqual(["/skills"]);
    // Secrets redacted from client payload.
    const env = res.mcpServers?.[0]?.env;
    if (env) {
      expect(JSON.stringify(env)).not.toContain("x");
    }
  });

  it("set applies engine settings and reports reload", async () => {
    const applyEngineSettings = vi.fn(async () => true);
    const deps = {
      getAll: () => ({ foo: 1 }) as never,
      getBundledSkillsInfo: () => ({ found: 2 }),
      getEffectiveSkillsPaths: () => [],
      set: (p: Record<string, unknown>) => ({ ...p, saved: true }),
      applyEngineSettings,
    };
    const res = (await dispatchSettingsMethod(
      "settings.set",
      { bar: 2 },
      deps,
    )) as { engineReloaded: boolean };
    expect(applyEngineSettings).toHaveBeenCalled();
    expect(res.engineReloaded).toBe(true);
  });

  it("vault.scan returns key-only payload", async () => {
    const deps = {
      getAll: () => ({}) as never,
      getBundledSkillsInfo: () => ({ found: false, root: null, packs: [] }),
      getEffectiveSkillsPaths: () => [],
      set: vi.fn(),
      applyEngineSettings: vi.fn(),
      scanLiteralSecrets: () => [
        { serverId: "s1", envKey: "API_KEY", kind: "secret_env_key" as const },
      ],
      vaultStatus: () => ({ attached: true, hardened: false }),
    };
    const res = (await dispatchSettingsMethod(
      "settings.vault.scan",
      {},
      deps,
    )) as { literalCount: number; hits: Array<{ envKey: string }> };
    expect(res.literalCount).toBe(1);
    expect(res.hits[0]?.envKey).toBe("API_KEY");
  });
});
