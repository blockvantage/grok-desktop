import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ensureDeskPlanesEngine,
  resolveDeskPlaneMcpServers,
} from "./ensure-desk-planes-engine.js";
import type { AppSettings } from "./settings.js";
import type { EngineAdapter } from "../engine-types.js";

const baseSettings = {
  maxConcurrentTasks: 1,
  mcpServers: [],
  skillsPaths: [],
  quietHours: null,
  defaultModel: "m",
  defaultEffort: "normal" as const,
  defaultApprovalMode: "balanced" as const,
  license: null,
  desktopControl: { enabled: false } as AppSettings["desktopControl"],
  onboardingCompleted: true,
} satisfies AppSettings;

describe("ensureDeskPlanesEngine", () => {
  it("resolves browser and desktop planes for provider fallback composition", () => {
    const mcpServers = resolveDeskPlaneMcpServers({
      mcpServers: [],
      env: {
        GROKDESK_BROWSER_URL: "http://127.0.0.1:9",
        GROKDESK_BROWSER_TOKEN: "browser-token",
        GROKDESK_BROWSER_MCP_PATH: "/tmp/browser-mcp.js",
        GROKDESK_DESKTOP_URL: "http://127.0.0.1:10",
        GROKDESK_DESKTOP_TOKEN: "desktop-token",
        GROKDESK_DESKTOP_MCP_PATH: "/tmp/desktop-mcp.js",
      },
      existsSync: () => true,
    });

    expect(mcpServers.map((server) => server.id)).toEqual([
      "desk-desktop",
      "desk-browser",
    ]);
  });

  it("composition preserves an already-selected AgentProvider engine", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../index.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(
      /ensureDeskBrowserEngine\(\s*engineSelection\.mode === "agent-provider",?\s*\)/,
    );
    expect(
      source.match(/mcpServers:\s*resolveDeskPlaneMcpServers\(/g),
    ).toHaveLength(2);
  });

  it("skips when engine override is set", async () => {
    const create = vi.fn();
    const ok = await ensureDeskPlanesEngine({
      hasEngineOverride: true,
      existsSync: () => true,
      getSettings: () => baseSettings,
      getEffectiveSkillsPaths: () => [],
      createEngine: create,
      setEngine: vi.fn(),
    });
    expect(ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("skips when no desk planes are present on disk", async () => {
    const create = vi.fn();
    const ok = await ensureDeskPlanesEngine({
      hasEngineOverride: false,
      env: {},
      existsSync: () => false,
      getSettings: () => baseSettings,
      getEffectiveSkillsPaths: () => [],
      createEngine: create,
      setEngine: vi.fn(),
    });
    expect(ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("rebuilds engine when browser plane is fully configured", async () => {
    const engine = { run: vi.fn() } as unknown as EngineAdapter;
    const setEngine = vi.fn();
    const create = vi.fn(async (input: { mcpServers: unknown[] }) => {
      expect(input.mcpServers.length).toBeGreaterThan(0);
      return engine;
    });
    const ok = await ensureDeskPlanesEngine({
      hasEngineOverride: false,
      env: {
        GROKDESK_BROWSER_URL: "http://127.0.0.1:9",
        GROKDESK_BROWSER_TOKEN: "tok",
        GROKDESK_BROWSER_MCP_PATH: "/tmp/browser-mcp.js",
      },
      existsSync: (p) => p === "/tmp/browser-mcp.js",
      getSettings: () => baseSettings,
      getEffectiveSkillsPaths: () => ["/skills"],
      createEngine: create,
      setEngine,
    });
    expect(ok).toBe(true);
    expect(setEngine).toHaveBeenCalledWith(engine);
  });

  it("returns false on createEngine failure (non-fatal)", async () => {
    const ok = await ensureDeskPlanesEngine({
      hasEngineOverride: false,
      env: {
        GROKDESK_BROWSER_URL: "http://127.0.0.1:9",
        GROKDESK_BROWSER_TOKEN: "tok",
        GROKDESK_BROWSER_MCP_PATH: "/tmp/browser-mcp.js",
      },
      existsSync: () => true,
      getSettings: () => baseSettings,
      getEffectiveSkillsPaths: () => [],
      createEngine: async () => {
        throw new Error("spawn fail");
      },
      setEngine: vi.fn(),
    });
    expect(ok).toBe(false);
  });
});
