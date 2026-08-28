import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "../index.js";
import { TestEngine } from "@grokdesk/engine-testkit";
import { dispatchGateway } from "../dispatch.js";

vi.mock("@grokdesk/engine-grok", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@grokdesk/engine-grok")>();
  return {
    ...actual,
    getGrokAuthStatus: vi.fn(async () => ({
      signedIn: true,
      accountLabel: "desk@example.com",
      accountName: "Desk",
      needsReauth: false,
      engineStatus: "ready" as const,
      binaryPath: "/tmp/grok",
      models: ["grok-4.5"],
      defaultModel: "grok-4.5",
    })),
  };
});

describe("Desk-scoped sign-out", () => {
  let dir: string;
  let gateway: Gateway;
  let authPath: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-desk-auth-"));
    authPath = path.join(dir, ".grok", "auth.json");
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        entry: {
          email: "desk@example.com",
          refresh_token: "keep-me",
          key: "access",
        },
      }),
    );
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

  it("sign-out overlays signed-out without deleting auth.json; sign-in reuses the CLI session", async () => {
    const before = (await dispatchGateway(gateway, {
      id: "1",
      method: "auth.status",
      params: {},
    })) as { signedIn: boolean; engineStatus: string; accountLabel: string | null };
    expect(before.signedIn).toBe(true);
    expect(before.engineStatus).toBe("ready");

    const out = (await dispatchGateway(gateway, {
      id: "2",
      method: "auth.signOut",
      params: {},
    })) as { ok: boolean; signedOut: boolean };
    expect(out.ok).toBe(true);
    expect(out.signedOut).toBe(true);
    expect(fs.existsSync(authPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(authPath, "utf8")).entry.refresh_token).toBe(
      "keep-me",
    );

    const signedOut = (await dispatchGateway(gateway, {
      id: "3",
      method: "auth.status",
      params: {},
    })) as {
      signedIn: boolean;
      needsReauth: boolean;
      engineStatus: string;
      accountLabel: string | null;
    };
    expect(signedOut.signedIn).toBe(false);
    expect(signedOut.needsReauth).toBe(false);
    expect(signedOut.engineStatus).toBe("signed_out");
    expect(signedOut.accountLabel).toBeNull();

    const signIn = (await dispatchGateway(gateway, {
      id: "4",
      method: "auth.signIn",
      params: {},
    })) as { ok: boolean; reusedSession?: boolean };
    expect(signIn.ok).toBe(true);
    expect(signIn.reusedSession).toBe(true);

    const after = (await dispatchGateway(gateway, {
      id: "5",
      method: "auth.status",
      params: {},
    })) as { signedIn: boolean; engineStatus: string; accountLabel: string | null };
    expect(after.signedIn).toBe(true);
    expect(after.engineStatus).toBe("ready");
    expect(after.accountLabel).toBe("desk@example.com");
  });
});
