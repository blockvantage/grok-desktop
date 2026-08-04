import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readSuperGrokAccessToken } from "./super-grok-token.js";

describe("readSuperGrokAccessToken", () => {
  let home: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "grokdesk-auth-"));
    await fs.mkdir(path.join(home, ".grok"), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it("returns access token from key field", async () => {
    await fs.writeFile(
      path.join(home, ".grok", "auth.json"),
      JSON.stringify({
        user: {
          email: "a@b.com",
          key: "test-access-token",
          refresh_token: "refresh",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      }),
    );
    const t = await readSuperGrokAccessToken(home);
    expect(t?.accessToken).toBe("test-access-token");
    expect(t?.signedIn).toBe(true);
    expect(t?.hasRefreshToken).toBe(true);
  });

  it("returns null when missing", async () => {
    const t = await readSuperGrokAccessToken(home);
    expect(t).toBeNull();
  });

  it("prefers entry with refresh + key", async () => {
    await fs.writeFile(
      path.join(home, ".grok", "auth.json"),
      JSON.stringify({
        stale: { key: "old" },
        live: {
          email: "x@y.com",
          key: "live-key",
          refresh_token: "r",
        },
      }),
    );
    const t = await readSuperGrokAccessToken(home);
    expect(t?.accessToken).toBe("live-key");
  });
});
