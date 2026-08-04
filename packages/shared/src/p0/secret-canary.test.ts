import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  writeProjectMcpConfig,
  writeEphemeralMcpConfig,
  expandMcpPlaceholders,
} from "../mcp-config-write.js";
import {
  containsLiteralSecret,
  redactMcpServersForClient,
  makeVaultRef,
  isVaultRef,
} from "../secret-redact.js";

const CANARY = "sk-canary-SECRET-TOKEN-9f3a2b1c0d";

describe("SEC-02 secret canary", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gd-secret-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("project config does not expand secret env placeholders to literals", () => {
    const p = writeProjectMcpConfig(
      tmp,
      [
        {
          id: "github",
          command: "npx",
          args: ["-y", "mcp-server"],
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
          enabled: true,
        },
      ],
      { ...process.env, GITHUB_TOKEN: CANARY },
    );
    expect(p).toBeTruthy();
    const body = fs.readFileSync(p!, "utf8");
    expect(containsLiteralSecret(body, CANARY)).toBe(false);
    expect(body).toContain("${GITHUB_TOKEN}");
  });

  it("full expand for ephemeral still can hold secrets only off-project", () => {
    const expanded = expandMcpPlaceholders(
      [
        {
          id: "github",
          command: "npx",
          args: [],
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
          enabled: true,
        },
      ],
      { GITHUB_TOKEN: CANARY },
    );
    expect(expanded[0]!.env?.GITHUB_TOKEN).toBe(CANARY);
    const eph = writeEphemeralMcpConfig(
      [
        {
          id: "github",
          command: "npx",
          args: [],
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
          enabled: true,
        },
      ],
      { GITHUB_TOKEN: CANARY },
      path.join(tmp, "eph"),
    );
    expect(eph).toBeTruthy();
    // Ephemeral dir is under tmp, not the user project workspace roots.
    expect(eph!.dir.startsWith(tmp)).toBe(true);
    fs.rmSync(eph!.dir, { recursive: true, force: true });
  });

  it("renderer-facing redaction strips literal secrets and keeps vault refs", () => {
    const ref = makeVaultRef("abc-123");
    expect(isVaultRef(ref)).toBe(true);
    const redacted = redactMcpServersForClient([
      {
        id: "x",
        command: "npx",
        args: [],
        env: {
          API_KEY: CANARY,
          SAFE: "hello",
          STORED: ref,
        },
        enabled: true,
      },
    ]);
    expect(redacted[0]!.env?.API_KEY).toBe("[REDACTED]");
    expect(redacted[0]!.env?.STORED).toBe(ref);
    expect(JSON.stringify(redacted)).not.toContain(CANARY);
  });
});
