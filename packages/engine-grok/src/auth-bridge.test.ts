import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readAuthFileMetadata,
  getGrokAuthStatus,
  shouldSkipBrowserLogin,
  startGrokLogin,
  clearLocalAuthSession,
  completeGrokSignOut,
  parseModelsCliProbe,
  deriveNeedsReauth,
} from "./auth-bridge.js";

describe("readAuthFileMetadata", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-auth-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns signed out when auth.json missing", async () => {
    const r = await readAuthFileMetadata(dir);
    expect(r.signedIn).toBe(false);
    expect(r.accountLabel).toBeNull();
    expect(r.needsLogin).toBe(true);
  });

  it("reads email from auth.json without exposing tokens", async () => {
    const grokDir = path.join(dir, ".grok");
    fs.mkdirSync(grokDir);
    fs.writeFileSync(
      path.join(grokDir, "auth.json"),
      JSON.stringify({
        "https://auth.x.ai::client": {
          email: "user@example.com",
          first_name: "Test",
          last_name: "User",
          refresh_token: "SECRET_SHOULD_NOT_LEAK",
          key: "ACCESS_SECRET",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      }),
    );
    const r = await readAuthFileMetadata(dir);
    expect(r.signedIn).toBe(true);
    expect(r.accountLabel).toBe("user@example.com");
    expect(r.hasRefreshToken).toBe(true);
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(JSON.stringify(r)).not.toContain("ACCESS");
  });

  it("stays signed in when access token expired but refresh_token exists", async () => {
    const grokDir = path.join(dir, ".grok");
    fs.mkdirSync(grokDir);
    fs.writeFileSync(
      path.join(grokDir, "auth.json"),
      JSON.stringify({
        "https://auth.x.ai::client": {
          email: "user@example.com",
          refresh_token: "REFRESH_STILL_VALID",
          key: "OLD_ACCESS",
          expires_at: "2020-01-01T00:00:00.000Z",
        },
      }),
    );
    const r = await readAuthFileMetadata(dir);
    expect(r.signedIn).toBe(true);
    expect(r.accessExpired).toBe(true);
    expect(r.needsLogin).toBe(false);
    expect(r.hasRefreshToken).toBe(true);
    expect(JSON.stringify(r)).not.toContain("REFRESH");
  });

  it("marks expired tokens without refresh as needs login", async () => {
    const grokDir = path.join(dir, ".grok");
    fs.mkdirSync(grokDir);
    fs.writeFileSync(
      path.join(grokDir, "auth.json"),
      JSON.stringify({
        entry: {
          email: "old@example.com",
          key: "dead",
          expires_at: "2020-01-01T00:00:00.000Z",
        },
      }),
    );
    const r = await readAuthFileMetadata(dir);
    expect(r.signedIn).toBe(false);
    expect(r.accessExpired).toBe(true);
    expect(r.needsLogin).toBe(true);
  });

  it("does not treat identity + expires_at alone as signed in", async () => {
    // Stale profile after partial logout used to flip UI back to "signed in".
    const grokDir = path.join(dir, ".grok");
    fs.mkdirSync(grokDir);
    fs.writeFileSync(
      path.join(grokDir, "auth.json"),
      JSON.stringify({
        entry: {
          email: "ghost@example.com",
          first_name: "Ghost",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      }),
    );
    const r = await readAuthFileMetadata(dir);
    expect(r.signedIn).toBe(false);
    expect(r.needsLogin).toBe(true);
  });
});

describe("clearLocalAuthSession / completeGrokSignOut", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-signout-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("clears auth.json so metadata reports signed out", async () => {
    const grokDir = path.join(dir, ".grok");
    fs.mkdirSync(grokDir);
    const authPath = path.join(grokDir, "auth.json");
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        entry: {
          email: "user@example.com",
          refresh_token: "secret",
          key: "access",
        },
      }),
    );
    const before = await readAuthFileMetadata(dir);
    expect(before.signedIn).toBe(true);

    const cleared = await clearLocalAuthSession(dir);
    expect(cleared.cleared).toBe(true);
    expect(fs.existsSync(authPath)).toBe(false);

    const after = await readAuthFileMetadata(dir);
    expect(after.signedIn).toBe(false);
  });

  it("completeGrokSignOut clears local session without a binary", async () => {
    const grokDir = path.join(dir, ".grok");
    fs.mkdirSync(grokDir);
    fs.writeFileSync(
      path.join(grokDir, "auth.json"),
      JSON.stringify({
        entry: { email: "u@x.com", refresh_token: "r", key: "k" },
      }),
    );
    const result = await completeGrokSignOut({ binary: null, home: dir });
    expect(result.signedOut).toBe(true);
    expect(result.localCleared).toBe(true);
    expect(result.cliLogout).toBe("skipped");
    expect(result.ok).toBe(true);
  });
});

describe("getGrokAuthStatus", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-auth-status-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports signed in from auth.json even when CLI binary is missing", async () => {
    const grokDir = path.join(dir, ".grok");
    fs.mkdirSync(grokDir);
    fs.writeFileSync(
      path.join(grokDir, "auth.json"),
      JSON.stringify({
        "https://auth.x.ai::client": {
          email: "persist@example.com",
          refresh_token: "refresh-token-value",
          expires_at: "2020-01-01T00:00:00.000Z",
        },
      }),
    );

    const status = await getGrokAuthStatus(
      { PATH: "", HOME: dir, USERPROFILE: dir },
      "darwin",
      dir,
    );

    expect(status.signedIn).toBe(true);
    expect(status.accountLabel).toBe("persist@example.com");
    expect(status.needsReauth).toBe(false);
    expect(status.binaryPath).toBeNull();
    expect(status.engineStatus).toBe("missing");
  });

  it("never-signed-in home is signed_out, not reauth", async () => {
    const status = await getGrokAuthStatus(
      { PATH: "", HOME: dir, USERPROFILE: dir },
      "darwin",
      dir,
    );
    expect(status.signedIn).toBe(false);
    expect(status.needsReauth).toBe(false);
    expect(status.accountLabel).toBeNull();
  });

  it("stale identity without tokens requires reauth", async () => {
    const grokDir = path.join(dir, ".grok");
    fs.mkdirSync(grokDir);
    fs.writeFileSync(
      path.join(grokDir, "auth.json"),
      JSON.stringify({
        entry: {
          email: "stale@example.com",
          key: "dead",
          expires_at: "2020-01-01T00:00:00.000Z",
        },
      }),
    );
    const status = await getGrokAuthStatus(
      { PATH: "", HOME: dir, USERPROFILE: dir },
      "darwin",
      dir,
    );
    expect(status.signedIn).toBe(false);
    expect(status.needsReauth).toBe(true);
    expect(status.accountLabel).toBe("stale@example.com");
  });
});

describe("deriveNeedsReauth", () => {
  it("is false when signed in or never signed in", () => {
    expect(
      deriveNeedsReauth({
        signedIn: true,
        accountLabel: "a@x.ai",
        accessExpired: false,
        hasRefreshToken: true,
      }),
    ).toBe(false);
    expect(
      deriveNeedsReauth({
        signedIn: false,
        accountLabel: null,
        accessExpired: false,
        hasRefreshToken: false,
      }),
    ).toBe(false);
  });

  it("is true when prior identity remains without a session", () => {
    expect(
      deriveNeedsReauth({
        signedIn: false,
        accountLabel: "a@x.ai",
        accessExpired: true,
        hasRefreshToken: false,
      }),
    ).toBe(true);
  });
});

describe("parseModelsCliProbe", () => {
  it("treats Grok Build unauthenticated catalog as signed out", () => {
    // Real CLI output after logout (grok 0.2.x): still lists models.
    const text = `You are not authenticated.

Default model: grok-4.5

Available models:
  * grok-4.5 (default)
  - grok-composer-2.5-fast
`;
    const r = parseModelsCliProbe(text);
    expect(r.signedIn).toBe(false);
    expect(r.defaultModel).toBe("grok-4.5");
    expect(r.models).toContain("grok-4.5");
    expect(r.models).toContain("grok-composer-2.5-fast");
  });

  it("treats explicit logged-in phrase as signed in", () => {
    const r = parseModelsCliProbe(
      "You are logged in as user@x.com\nDefault model: grok-4.5\n  * grok-4.5\n",
    );
    expect(r.signedIn).toBe(true);
    expect(r.defaultModel).toBe("grok-4.5");
  });

  it("does not treat model list alone as a session", () => {
    const r = parseModelsCliProbe(
      "Default model: grok-4.5\nAvailable models:\n  * grok-4.5\n",
    );
    expect(r.signedIn).toBe(false);
  });
});

describe("shouldSkipBrowserLogin / startGrokLogin dry-run", () => {
  it("skips browser under VITEST and explicit flag", () => {
    expect(shouldSkipBrowserLogin({ VITEST: "true" })).toBe(true);
    expect(shouldSkipBrowserLogin({ NODE_ENV: "test" })).toBe(true);
    expect(shouldSkipBrowserLogin({ GROKDESK_SKIP_BROWSER_LOGIN: "1" })).toBe(
      true,
    );
    expect(
      shouldSkipBrowserLogin({
        VITEST: "true",
        GROKDESK_SKIP_BROWSER_LOGIN: "0",
      }),
    ).toBe(false);
    expect(shouldSkipBrowserLogin({ NODE_ENV: "production" })).toBe(false);
  });

  it("startGrokLogin does not spawn when skip is active", async () => {
    // Would open a browser if spawn ran; must return skipped without using a real binary.
    const result = await startGrokLogin("/nonexistent/grok-binary", {
      oauth: true,
      env: { ...process.env, GROKDESK_SKIP_BROWSER_LOGIN: "1" },
    });
    expect(result.skipped).toBe(true);
    expect(result.pid).toBeUndefined();
  });
});
