/**
 * Integration: settings.vault.scan|migrate through Gateway.handle + real SettingsService.
 * Proves vaultStatus binding and key-only payloads on the shipped IPC path.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "../index.js";
import { TestEngine } from "@grokdesk/engine-testkit";

const CANARY = "sk-vault-ipc-CANARY-never-in-payload-zz88";

describe("settings.vault IPC (Gateway + SettingsService)", () => {
  let dir: string;
  let gw: Gateway;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-vault-ipc-"));
    gw = new Gateway(
      {
        dataDir: dir,
        dbPath: path.join(dir, "db.sqlite"),
        logsDir: path.join(dir, "logs"),
      },
      { engine: new TestEngine() },
    );
    await gw.start();
  });

  afterEach(async () => {
    await gw.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("vault.scan reports attached vault without throwing (bound vaultStatus)", async () => {
    const scan = (await gw.handle({
      id: "v1",
      method: "settings.vault.scan",
      params: {},
    })) as {
      literalCount: number;
      hits: Array<{ serverId: string; envKey: string }>;
      vaultAttached: boolean;
      hardened: boolean;
    };
    expect(scan.vaultAttached).toBe(true);
    expect(typeof scan.hardened).toBe("boolean");
    expect(Array.isArray(scan.hits)).toBe(true);
    expect(JSON.stringify(scan)).not.toContain(CANARY);
  });

  it("vault.scan|migrate stay key-only after set with secret; migrate clears literals", async () => {
    await gw.handle({
      id: "s1",
      method: "settings.set",
      params: {
        mcpServers: [
          {
            id: "sec",
            command: "npx",
            args: [],
            env: { API_KEY: CANARY },
            enabled: true,
          },
        ],
      },
    });

    // After set, vaultize should already have rewritten to vault: refs on write.
    const afterSet = gw.settings.getAll();
    const stored = afterSet.mcpServers[0]?.env?.API_KEY;
    expect(stored).toBeDefined();
    expect(stored).not.toBe(CANARY);
    expect(stored!.startsWith("vault:")).toBe(true);

    const scan = (await gw.handle({
      id: "v2",
      method: "settings.vault.scan",
      params: {},
    })) as {
      literalCount: number;
      hits: Array<{ envKey: string }>;
      vaultAttached: boolean;
    };
    expect(scan.vaultAttached).toBe(true);
    expect(scan.literalCount).toBe(0);
    expect(JSON.stringify(scan)).not.toContain(CANARY);

    const migrate = (await gw.handle({
      id: "v3",
      method: "settings.vault.migrate",
      params: { dryRun: true },
    })) as {
      dryRun: boolean;
      migratedCount: number;
      hasRemainingLiterals: boolean;
      migrated: Array<{ envKey: string }>;
    };
    expect(migrate.dryRun).toBe(true);
    expect(migrate.hasRemainingLiterals).toBe(false);
    expect(JSON.stringify(migrate)).not.toContain(CANARY);
  });
});
