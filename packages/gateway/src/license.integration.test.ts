import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "./index.js";
import { TestEngine } from "@grokdesk/engine-testkit";
import { hasSkillPacks } from "@grokdesk/shared/node";

describe("Gateway settings + connectors integration", () => {
  let dir: string;
  let gw: Gateway;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-lic-gw-"));
    gw = new Gateway(
      {
        dataDir: dir,
        dbPath: path.join(dir, "db.sqlite"),
        logsDir: path.join(dir, "logs"),
      },
      { engine: new TestEngine(), machineId: "test-machine-1" },
    );
    await gw.start();
  });

  afterEach(async () => {
    await gw.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("settings.get exposes effectiveSkillsPaths with bundled packs", async () => {
    const s = (await gw.handle({
      id: "1",
      method: "settings.get",
      params: {},
    })) as { skillsPaths: string[]; effectiveSkillsPaths: string[] };
    expect(s.skillsPaths).toEqual([]);
    expect(s.effectiveSkillsPaths.length).toBeGreaterThanOrEqual(1);
    expect(hasSkillPacks(s.effectiveSkillsPaths[0]!)).toBe(true);
  });

  it("connectors.enable persists via settings and reloads engine config", async () => {
    const next = (await gw.handle({
      id: "2",
      method: "connectors.enable",
      params: { presetId: "filesystem" },
    })) as {
      mcpServers: Array<{ id: string; enabled: boolean }>;
      engineReloaded?: boolean;
    };
    expect(next.mcpServers.some((m) => m.id === "filesystem" && m.enabled)).toBe(
      true,
    );
    // Test injects engineOverride (TestEngine) so no live engine swap — honest flag.
    expect(next.engineReloaded).toBe(false);
    const s = (await gw.handle({
      id: "3",
      method: "settings.get",
      params: {},
    })) as { mcpServers: Array<{ id: string; enabled: boolean }> };
    expect(s.mcpServers.some((m) => m.id === "filesystem" && m.enabled)).toBe(
      true,
    );
  });

  it("connectors.listPresets is a rich catalog; enableRecommended is seamless", async () => {
    const list = (await gw.handle({
      id: "2b",
      method: "connectors.listPresets",
      params: {},
    })) as Array<{
      id: string;
      recommended: boolean;
      longDescription: string;
      category: string;
    }>;
    expect(list.length).toBeGreaterThanOrEqual(12);
    expect(list.every((p) => p.longDescription.length > 20)).toBe(true);
    expect(list.some((p) => p.id === "github" && p.category === "dev")).toBe(
      true,
    );

    const rec = (await gw.handle({
      id: "2c",
      method: "connectors.enableRecommended",
      params: {},
    })) as { mcpServers: Array<{ id: string; enabled: boolean }> };
    const ids = rec.mcpServers.filter((m) => m.enabled).map((m) => m.id);
    expect(ids).toContain("filesystem");
    expect(ids).toContain("memory");
    expect(ids).toContain("sequential-thinking");
    // uvx connectors are recommended in UI but not auto-enabled on first run
    expect(ids).not.toContain("fetch");
  });

  it("settings.set rejects license injection", async () => {
    await expect(
      gw.handle({
        id: "inject",
        method: "settings.set",
        params: { license: { key: "forged" } },
      }),
    ).rejects.toThrow(/not allowed/);
  });

  it("rejects retired gateway licensing and disk-manifest RPCs", async () => {
    for (const method of [
      "license.status",
      "license.activate",
      "license.verify",
      "updates.manifest",
    ]) {
      await expect(
        gw.handle({ id: method, method, params: {} } as never),
      ).rejects.toThrow();
    }
  });
});
