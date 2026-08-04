import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "../index.js";
import { TestEngine } from "@grokdesk/engine-testkit";
import { dispatchGateway } from "../dispatch.js";

// Mock CLI auth probe so this suite never spawns `grok models` (H6 flake).
vi.mock("@grokdesk/engine-grok", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@grokdesk/engine-grok")>();
  return {
    ...actual,
    getGrokAuthStatus: vi.fn(async () => ({
      signedIn: false,
      accountLabel: null,
      accountName: null,
      needsReauth: true,
      engineStatus: "needs_auth" as const,
      binaryPath: null,
      models: [] as string[],
      defaultModel: null,
    })),
  };
});

describe("Gateway auth IPC", () => {
  let dir: string;
  let gateway: Gateway;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-auth-ipc-"));
    gateway = new Gateway(
      {
        dataDir: dir,
        logsDir: path.join(dir, "logs"),
        dbPath: path.join(dir, "db.sqlite"),
      },
      { engine: new TestEngine() },
    );
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns structured auth.status without crashing", async () => {
    const status = (await dispatchGateway(gateway, {
      id: "1",
      method: "auth.status",
      params: {},
    })) as {
      signedIn: boolean;
      accountLabel: string | null;
      engineStatus: string;
    };
    expect(status.signedIn).toBe(false);
    expect(status.engineStatus).toBe("needs_auth");
  });

  it("auth.signIn never opens a browser in tests (dry-run or missing CLI)", async () => {
    const res = (await dispatchGateway(gateway, {
      id: "2",
      method: "auth.signIn",
      params: {},
    })) as { ok: boolean; message: string };
    expect(typeof res.ok).toBe("boolean");
    expect(typeof res.message).toBe("string");
    expect(res.message.length).toBeGreaterThan(5);
    // Must not claim a real OAuth browser was opened during vitest.
    expect(res.message.toLowerCase()).not.toMatch(/opened grok login/);
    if (res.ok) {
      expect(res.message.toLowerCase()).toMatch(
        /dry-run|browser not opened|not found/,
      );
    }
  });
});
