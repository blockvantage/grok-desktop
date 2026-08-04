import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "../index.js";
import { TestEngine } from "@grokdesk/engine-testkit";

const CANARY = "sk-settings-CANARY-token-aabbccdd";

describe("SEC-02 settings.get redaction", () => {
  let dir: string;
  let gw: Gateway;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-set-"));
    gw = new Gateway(
      {
        dataDir: dir,
        dbPath: path.join(dir, "db.sqlite"),
        logsDir: path.join(dir, "logs"),
      },
      { engine: new TestEngine() },
    );
    await gw.start();
    gw.settings.set({
      mcpServers: [
        {
          id: "sec",
          command: "npx",
          args: [],
          env: { API_KEY: CANARY },
          enabled: true,
        },
      ],
    });
  });

  afterEach(async () => {
    await gw.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("settings.get does not return literal API_KEY to the client", async () => {
    const res = (await gw.handle({
      id: "s1",
      method: "settings.get",
      params: {},
    })) as {
      settings: { mcpServers: Array<{ env?: Record<string, string> }> };
      mcpServers: Array<{ env?: Record<string, string> }>;
    };
    const json = JSON.stringify(res);
    expect(json).not.toContain(CANARY);
    // After vault migrate: opaque vault: refs are safe for client; legacy path uses [REDACTED].
    const v = res.settings.mcpServers[0]?.env?.API_KEY;
    expect(v === "[REDACTED]" || v?.startsWith("vault:")).toBe(true);
    expect(res.mcpServers[0]?.env?.API_KEY).toBe(v);
  });

  it("internal storage migrates literals to vault refs; resolve restores for engine", () => {
    const all = gw.settings.getAll();
    const stored = all.mcpServers[0]?.env?.API_KEY;
    expect(stored).toBeDefined();
    // Gateway start attaches file vault and migrates — SQLite must not keep canary.
    expect(stored).not.toBe(CANARY);
    expect(stored!.startsWith("vault:")).toBe(true);
    const resolved = gw.settings.getMcpServersResolved();
    expect(resolved[0]?.env?.API_KEY).toBe(CANARY);
    // DB file must not contain plaintext canary after migrate.
    const dbBody = fs.readFileSync(path.join(dir, "db.sqlite"));
    expect(dbBody.toString("utf8")).not.toContain(CANARY);
  });

  it("dry-run scan reports remaining-safe after migrate", () => {
    expect(gw.settings.scanLiteralSecrets()).toEqual([]);
    const report = gw.settings.migrateLiteralsToVault({ dryRun: true });
    expect(report.hasRemainingLiterals).toBe(false);
  });
});
