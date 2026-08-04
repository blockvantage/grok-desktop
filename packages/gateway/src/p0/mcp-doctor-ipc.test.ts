import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "../index.js";
import { TestEngine } from "@grokdesk/engine-testkit";

const CANARY = "sk-ipc-doctor-CANARY-never";

describe("connectors.doctor IPC", () => {
  let dir: string;
  let gw: Gateway;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-doc-"));
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
          args: ["-y", "x"],
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

  it("returns findings without secret values", async () => {
    const res = (await gw.handle({
      id: "d1",
      method: "connectors.doctor",
      params: {},
    })) as { reports: Array<{ findings: unknown[] }> };
    expect(res.reports).toHaveLength(1);
    expect(JSON.stringify(res)).not.toContain(CANARY);
  });
});
