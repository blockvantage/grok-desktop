import { describe, it, expect } from "vitest";
import {
  CONNECTOR_PRESETS,
  CONNECTOR_CATEGORIES,
  enableConnectorPreset,
  disableConnectorPreset,
  expandPresetArgs,
  expandPresetEnv,
  listConnectorPresets,
  filterConnectorPresets,
  listRecommendedConnectorIds,
  enableRecommendedConnectors,
  listPresetEnvPlaceholders,
  hasConfiguredCredentials,
} from "./connector-presets.js";

describe("connector-presets catalog", () => {
  it("ships a rich gallery with categories and recommended set", () => {
    const list = listConnectorPresets();
    expect(list.length).toBeGreaterThanOrEqual(12);
    expect(list.some((p) => p.id === "filesystem")).toBe(true);
    expect(list.some((p) => p.id === "github")).toBe(true);
    expect(list.some((p) => p.id === "slack")).toBe(true);
    expect(list.some((p) => p.id === "brave-search")).toBe(true);
    expect(CONNECTOR_PRESETS.length).toBe(list.length);

    for (const p of list) {
      expect(p.description.length).toBeGreaterThan(12);
      expect(p.longDescription.length).toBeGreaterThan(40);
      expect(p.capabilities.length).toBeGreaterThanOrEqual(1);
      expect(p.category).toBeTruthy();
      expect(p.tags.length).toBeGreaterThan(0);
    }

    const rec = listRecommendedConnectorIds();
    expect(rec.length).toBeGreaterThanOrEqual(4);
    expect(rec).toContain("filesystem");
    expect(CONNECTOR_CATEGORIES.some((c) => c.id === "recommended")).toBe(true);
  });

  it("expands HOME and env tokens in args and env maps", () => {
    const args = expandPresetArgs(["${HOME}/docs", "${DATABASE_URL}"], {
      HOME: "/Users/test",
      DATABASE_URL: "postgres://local/db",
    });
    expect(args[0]).toBe("/Users/test/docs");
    expect(args[1]).toBe("postgres://local/db");

    const env = expandPresetEnv(
      { BRAVE_API_KEY: "${BRAVE_API_KEY}" },
      { BRAVE_API_KEY: "secret-key" },
    );
    expect(env?.BRAVE_API_KEY).toBe("secret-key");
  });

  it("enableConnectorPreset merges and enables; disable flips enabled", () => {
    const { servers, preset, missingEnv } = enableConnectorPreset(
      [{ id: "other", command: "echo", args: [], enabled: true }],
      "filesystem",
      { HOME: "/home/me" },
    );
    expect(preset.id).toBe("filesystem");
    expect(missingEnv).toEqual([]);
    const fs = servers.find((s) => s.id === "filesystem");
    expect(fs?.enabled).toBe(true);
    expect(fs?.command).toBe("npx");
    expect(fs?.args.some((a) => a.includes("/home/me"))).toBe(true);
    expect(servers.some((s) => s.id === "other")).toBe(true);

    const disabled = disableConnectorPreset(servers, "filesystem");
    expect(disabled.find((s) => s.id === "filesystem")?.enabled).toBe(false);
  });

  it("reports missing env for auth connectors without keys", () => {
    const { missingEnv } = enableConnectorPreset([], "github", {
      HOME: "/tmp",
    });
    expect(missingEnv).toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
  });

  it("stores credential literals on the server row when provided", () => {
    const { servers, missingEnv } = enableConnectorPreset(
      [],
      "brave-search",
      { HOME: "/tmp" },
      { BRAVE_API_KEY: "sk-test-brave" },
    );
    expect(missingEnv).toEqual([]);
    const row = servers.find((s) => s.id === "brave-search");
    expect(row?.env?.BRAVE_API_KEY).toBe("sk-test-brave");
    expect(row?.enabled).toBe(true);
    const placeholders = listPresetEnvPlaceholders(
      listConnectorPresets().find((p) => p.id === "brave-search")!,
    );
    expect(placeholders).toContain("BRAVE_API_KEY");
    expect(hasConfiguredCredentials(row, placeholders)).toBe(true);
  });

  it("throws on unknown preset", () => {
    expect(() => enableConnectorPreset([], "nope-xyz")).toThrow(/Unknown/);
  });

  it("filterConnectorPresets supports search, category, recommended, enabled", () => {
    const all = listConnectorPresets();
    const rec = filterConnectorPresets(all, { category: "recommended" });
    expect(rec.every((p) => p.recommended)).toBe(true);
    expect(rec.length).toBeGreaterThanOrEqual(4);

    const dev = filterConnectorPresets(all, { category: "dev" });
    expect(dev.every((p) => p.category === "dev")).toBe(true);
    expect(dev.some((p) => p.id === "github")).toBe(true);

    const search = filterConnectorPresets(all, { query: "pull request" });
    expect(search.some((p) => p.id === "github")).toBe(true);

    const enabled = filterConnectorPresets(all, {
      enabledOnly: true,
      enabledServerIds: ["filesystem"],
    });
    expect(enabled).toHaveLength(1);
    expect(enabled[0]!.id).toBe("filesystem");

    const noAuth = filterConnectorPresets(all, { hideAuthRequired: true });
    expect(noAuth.every((p) => !p.requiresAuth)).toBe(true);
  });

  it("enableRecommendedConnectors enables free npx actives only", () => {
    const servers = enableRecommendedConnectors([], { HOME: "/tmp/home" });
    const ids = servers.filter((s) => s.enabled).map((s) => s.id);
    expect(ids).toContain("filesystem");
    expect(ids).toContain("memory");
    expect(ids).toContain("sequential-thinking");
    // uvx connectors are recommended in UI but not auto-enabled (uv may be missing)
    expect(ids).not.toContain("fetch");
    expect(ids).not.toContain("git");
    // Auth-required should NOT auto-enable
    expect(ids).not.toContain("github");
    expect(ids).not.toContain("slack");
  });

  it("enableRecommendedConnectors does not overwrite customized server", () => {
    const custom = [
      {
        id: "filesystem",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/custom"],
        enabled: true,
      },
    ];
    const servers = enableRecommendedConnectors(custom, { HOME: "/tmp/home" });
    const fs = servers.find((s) => s.id === "filesystem");
    expect(fs?.args.some((a) => a.includes("/custom"))).toBe(true);
  });

  it("marks broken packages fixed via uvx / sentry successor", () => {
    const fetch = CONNECTOR_PRESETS.find((p) => p.id === "fetch")!;
    expect(fetch.runtime).toBe("uvx");
    expect(fetch.packageName).toBe("mcp-server-fetch");
    const git = CONNECTOR_PRESETS.find((p) => p.id === "git")!;
    expect(git.runtime).toBe("uvx");
    const sentry = CONNECTOR_PRESETS.find((p) => p.id === "sentry")!;
    expect(sentry.packageName).toBe("@sentry/mcp-server");
    const sqlite = CONNECTOR_PRESETS.find((p) => p.id === "sqlite")!;
    expect(sqlite.runtime).toBe("uvx");
  });

  it("keeps secret placeholders when enabling auth connectors", () => {
    const { servers } = enableConnectorPreset([], "postgres", {
      HOME: "/tmp",
      DATABASE_URL: "postgres://user:secret@localhost/db",
    });
    const row = servers.find((s) => s.id === "postgres")!;
    // Must not bake the password into persisted settings
    expect(JSON.stringify(row)).not.toContain("secret");
    expect(row.args.some((a) => a.includes("${DATABASE_URL}"))).toBe(true);
  });
});
