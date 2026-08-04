import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "../index.js";
import { TestEngine } from "@grokdesk/engine-testkit";
import { RemoteApplicationService } from "./remote-application.js";

describe("RemoteApplicationService", () => {
  let dir: string;
  let gw: Gateway;
  let app: RemoteApplicationService;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-rapp-"));
    gw = new Gateway(
      {
        dataDir: dir,
        dbPath: path.join(dir, "db.sqlite"),
        logsDir: path.join(dir, "logs"),
      },
      { engine: new TestEngine(), machineId: "mach-app" },
    );
    await gw.start();
    app = new RemoteApplicationService(gw);
  });

  afterEach(async () => {
    await gw.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects forbidden methods", async () => {
    const res = await app.handle(
      "auth.signIn",
      {},
      { deviceId: "d1", machineId: "mach-app", requestId: "r1" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not allowed/i);
  });

  it("lists tasks with principal context", async () => {
    const res = await app.handle(
      "tasks.list",
      {},
      { deviceId: "d1", machineId: "mach-app", requestId: "r2" },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(Array.isArray(res.result)).toBe(true);
  });

  it("redacts secrets from error messages returned to the phone", async () => {
    const spy = vi.spyOn(gw, "handle").mockRejectedValueOnce(
      new Error('pairSecret=super-secret-pair-token-xyz productKey=GD1.leak.me'),
    );
    const res = await app.handle(
      "tasks.list",
      {},
      { deviceId: "d1", machineId: "mach-app", requestId: "r-redact" },
    );
    spy.mockRestore();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/super-secret-pair-token/);
      expect(res.error).not.toMatch(/GD1\.leak/);
      expect(res.error).toMatch(/REDACTED|pairSecret/i);
    }
  });
});
