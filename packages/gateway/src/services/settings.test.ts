import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import {
  sanitizeStoredMcpServers,
  SettingsService,
} from "./settings.js";
import { MemoryCredentialVault } from "./credential-vault.js";
import { hasSkillPacks, writeProjectMcpConfig } from "@grokdesk/shared/node";

describe("sanitizeStoredMcpServers", () => {
  it("drops corrupt rows and caps command length", () => {
    expect(sanitizeStoredMcpServers(null)).toEqual([]);
    expect(
      sanitizeStoredMcpServers([
        {
          id: "ok",
          command: "npx",
          args: ["-y", "pkg"],
          enabled: true,
        },
        { id: "bad" },
        {
          id: "huge-cmd",
          command: "x".repeat(600),
          args: [],
          enabled: true,
        },
      ]),
    ).toEqual([
      {
        id: "ok",
        command: "npx",
        args: ["-y", "pkg"],
        enabled: true,
      },
    ]);
  });
});

describe("SettingsService skills + connectors + license", () => {
  let dir: string;
  let db: Db;
  let settings: SettingsService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-settings-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    settings = new SettingsService(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("getAll drops corrupt mcpServers rows from SQLite", () => {
    db.prepare(
      `INSERT INTO settings (key, value_json) VALUES ('app', ?)`,
    ).run(
      JSON.stringify({
        mcpServers: [
          { id: "ok", command: "npx", args: [], enabled: true },
          { not: "a server" },
          {
            id: "toolong",
            command: "c".repeat(600),
            args: [],
            enabled: true,
          },
        ],
      }),
    );
    const servers = settings.getAll().mcpServers;
    expect(servers).toHaveLength(1);
    expect(servers[0]!.id).toBe("ok");
  });

  it("getEffectiveSkillsPaths includes bundled packs when user paths empty", () => {
    const paths = settings.getEffectiveSkillsPaths();
    expect(paths.length).toBeGreaterThanOrEqual(1);
    expect(hasSkillPacks(paths[0]!)).toBe(true);
  });

  it("enableConnectorPreset persists enabled MCP server", () => {
    expect(settings.getAll().mcpServers).toEqual([]);
    const next = settings.enableConnectorPreset("filesystem");
    expect(next.mcpServers.some((m) => m.id === "filesystem" && m.enabled)).toBe(
      true,
    );
    const again = settings.getAll();
    expect(again.mcpServers.some((m) => m.id === "filesystem" && m.enabled)).toBe(
      true,
    );
    const disabled = settings.disableConnectorPreset("filesystem");
    expect(
      disabled.mcpServers.find((m) => m.id === "filesystem")?.enabled,
    ).toBe(false);
  });

  it("enableConnectorPreset with credentials stores env that reaches TOML writer", () => {
    // Without vault: legacy path still persists credential for engine (redacted on IPC).
    const next = settings.enableConnectorPreset("brave-search", {
      BRAVE_API_KEY: "sk-live-test-key",
    });
    const row = next.mcpServers.find((m) => m.id === "brave-search");
    expect(row?.enabled).toBe(true);
    expect(row?.env?.BRAVE_API_KEY).toBe("sk-live-test-key");
    // Values must not be left as ${PLACEHOLDER}
    expect(row?.env?.BRAVE_API_KEY).not.toMatch(/\$\{/);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-mcp-env-"));
    try {
      const configPath = writeProjectMcpConfig(outDir, next.mcpServers);
      expect(configPath).toBeTruthy();
      const body = fs.readFileSync(configPath!, "utf8");
      expect(body).toContain("[mcp_servers.brave-search]");
      expect(body).toContain("BRAVE_API_KEY");
      expect(body).toContain("sk-live-test-key");
      expect(body).not.toContain("${BRAVE_API_KEY}");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("with vault, connector credentials become vault refs (no literal in SQLite)", () => {
    const vault = new MemoryCredentialVault();
    settings.setCredentialVault(vault);
    const next = settings.enableConnectorPreset("brave-search", {
      BRAVE_API_KEY: "sk-live-test-key-vaulted",
    });
    const row = next.mcpServers.find((m) => m.id === "brave-search");
    expect(row?.env?.BRAVE_API_KEY?.startsWith("vault:")).toBe(true);
    expect(JSON.stringify(next)).not.toContain("sk-live-test-key-vaulted");
    const resolved = settings.getMcpServersResolved();
    expect(
      resolved.find((m) => m.id === "brave-search")?.env?.BRAVE_API_KEY,
    ).toBe("sk-live-test-key-vaulted");
  });

  it("enableRecommendedConnectors persists free npx essentials", () => {
    const next = settings.enableRecommendedConnectors();
    const ids = next.mcpServers.filter((m) => m.enabled).map((m) => m.id);
    expect(ids).toContain("filesystem");
    expect(ids).toContain("memory");
    expect(ids).not.toContain("fetch"); // uvx — not auto-enabled
    expect(settings.listConnectorPresets().length).toBeGreaterThanOrEqual(12);
  });

  it("settings.set rejects license injection and invalid concurrency", () => {
    expect(() => settings.set({ license: { key: "forged" } })).toThrow(
      /not allowed/,
    );
    expect(() => settings.set({ maxConcurrentTasks: 0 })).toThrow();
    const ok = settings.set({ maxConcurrentTasks: 2 });
    expect(ok.maxConcurrentTasks).toBe(2);
  });

  it("defaults onboardingCompleted to false and persists true", () => {
    expect(settings.getAll().onboardingCompleted).toBe(false);
    const next = settings.set({ onboardingCompleted: true });
    expect(next.onboardingCompleted).toBe(true);
    expect(settings.getAll().onboardingCompleted).toBe(true);
  });

  it("stores license activation state", () => {
    const act = {
      key: "GD1.test",
      licenseId: "abc",
      email: null,
      machineId: "m",
      activatedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      graceUntil: new Date(Date.now() + 1000).toISOString(),
      product: "grokdesk" as const,
    };
    settings.setLicense(act);
    expect(settings.getAll().license?.licenseId).toBe("abc");
  });
});
