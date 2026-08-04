import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  verifyRuntimeBinary,
  type ProbeRunResult,
  type RunProbeFn,
} from "./runtime-verifier.js";
import type { PlatformSigningResult } from "./runtime-types.js";

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function probeOk(stdout: string, durationMs = 5): ProbeRunResult {
  return {
    code: 0,
    stdout,
    stderr: "",
    durationMs,
    timedOut: false,
  };
}

describe("runtime-verifier", () => {
  let dir: string;
  let binaryPath: string;
  const content = Buffer.from("fake-grok-binary-v0.9.4\n");
  const digest = sha256Hex(content);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-runtime-verify-"));
    binaryPath = path.join(dir, "grok");
    fs.writeFileSync(binaryPath, content, { mode: 0o600 });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const goodSig: PlatformSigningResult = {
    checked: true,
    valid: true,
    teamId: "TEAM1",
  };

  function goodProbes(version = "0.9.4"): RunProbeFn {
    return async (_bin, args) => {
      if (args[0] === "--version") return probeOk(`grok ${version}`);
      if (args[0] === "--help") {
        return probeOk("usage: grok\nagent\nmanaged-no-self-update");
      }
      if (args[0] === "agent" && args[1] === "--help") {
        return probeOk("agent commands help");
      }
      return { code: 1, stdout: "", stderr: "nope", durationMs: 1, timedOut: false };
    };
  }

  it("accepts matching size, digest, signature, version, and capabilities", async () => {
    const result = await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "0.9.4",
        expectedSha256: digest,
        expectedSizeBytes: content.length,
        target: "darwin-arm64",
        signingPolicy: {
          requirePlatformSignature: true,
          macTeamId: "TEAM1",
        },
        requiredCapabilities: ["agent", "managed-no-self-update"],
        declaredCapabilities: ["agent", "managed-no-self-update"],
      },
      {
        platform: "darwin",
        runProbe: goodProbes(),
        verifySignature: async () => goodSig,
        setExecutable: (p) => fs.chmodSync(p, 0o755),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digestSha256).toBe(digest);
    expect(result.probes.map((p) => p.name)).toEqual([
      "version",
      "help",
      "agent_help",
    ]);
    expect(result.capabilities).toEqual(
      expect.arrayContaining(["agent", "managed-no-self-update"]),
    );
    if (process.platform !== "win32") {
      expect(fs.statSync(binaryPath).mode & 0o777).toBe(0o755);
    }
  });

  it("rejects size mismatch", async () => {
    const result = await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "0.9.4",
        expectedSha256: digest,
        expectedSizeBytes: content.length + 10,
        target: "darwin-arm64",
        signingPolicy: { requirePlatformSignature: false },
      },
      { runProbe: goodProbes(), verifySignature: async () => ({ checked: false, valid: true }) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("size_mismatch");
  });

  it("rejects digest mismatch", async () => {
    const result = await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "0.9.4",
        expectedSha256: "a".repeat(64),
        expectedSizeBytes: content.length,
        target: "darwin-arm64",
        signingPolicy: { requirePlatformSignature: false },
      },
      { runProbe: goodProbes(), verifySignature: async () => ({ checked: false, valid: true }) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("digest_mismatch");
  });

  it("rejects invalid platform signature when required", async () => {
    const result = await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "0.9.4",
        expectedSha256: digest,
        expectedSizeBytes: content.length,
        target: "darwin-arm64",
        signingPolicy: { requirePlatformSignature: true },
      },
      {
        runProbe: goodProbes(),
        verifySignature: async () => ({
          checked: true,
          valid: false,
          detail: "wrong_team_id",
        }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("signature_invalid");
  });

  it("rejects unsigned artifact when signature required but not checked", async () => {
    const result = await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "0.9.4",
        expectedSha256: digest,
        expectedSizeBytes: content.length,
        target: "darwin-arm64",
        signingPolicy: { requirePlatformSignature: true },
      },
      {
        runProbe: goodProbes(),
        verifySignature: async () => ({
          checked: false,
          valid: true,
          detail: "skipped",
        }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsigned_required");
  });

  it("rejects version mismatch from --version probe", async () => {
    const result = await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "0.9.4",
        expectedSha256: digest,
        expectedSizeBytes: content.length,
        target: "darwin-arm64",
        signingPolicy: { requirePlatformSignature: false },
      },
      {
        runProbe: goodProbes("0.8.0"),
        verifySignature: async () => ({ checked: false, valid: true }),
        setExecutable: () => undefined,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("version_mismatch");
  });

  it("rejects an invalid expected SemVer", async () => {
    const result = await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "release-next",
        expectedSha256: digest,
        expectedSizeBytes: content.length,
        target: "darwin-arm64",
        signingPolicy: { requirePlatformSignature: false },
      },
      {
        runProbe: goodProbes(),
        verifySignature: async () => ({ checked: false, valid: true }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_version");
  });

  it("rejects a probed version that only contains the expected version as a substring", async () => {
    const result = await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "0.9.4",
        expectedSha256: digest,
        expectedSizeBytes: content.length,
        target: "darwin-arm64",
        signingPolicy: { requirePlatformSignature: false },
      },
      {
        runProbe: goodProbes("10.9.40"),
        verifySignature: async () => ({ checked: false, valid: true }),
        setExecutable: () => undefined,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("version_mismatch");
  });

  it("rejects probe timeout", async () => {
    const result = await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "0.9.4",
        expectedSha256: digest,
        expectedSizeBytes: content.length,
        target: "darwin-arm64",
        signingPolicy: { requirePlatformSignature: false },
      },
      {
        setExecutable: () => undefined,
        verifySignature: async () => ({ checked: false, valid: true }),
        runProbe: async () => ({
          code: null,
          stdout: "",
          stderr: "",
          durationMs: 10_000,
          timedOut: true,
        }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("probe_timeout");
  });

  it("rejects missing agent --help", async () => {
    const runProbe: RunProbeFn = async (_b, args) => {
      if (args[0] === "--version") return probeOk("grok 0.9.4");
      if (args[0] === "--help") return probeOk("help");
      return {
        code: 1,
        stdout: "",
        stderr: "unknown command",
        durationMs: 2,
        timedOut: false,
      };
    };
    const result = await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "0.9.4",
        expectedSha256: digest,
        expectedSizeBytes: content.length,
        target: "darwin-arm64",
        signingPolicy: { requirePlatformSignature: false },
      },
      {
        runProbe,
        setExecutable: () => undefined,
        verifySignature: async () => ({ checked: false, valid: true }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("agent_help_missing");
  });

  it("rejects missing required capability not declared", async () => {
    const runProbe: RunProbeFn = async (_b, args) => {
      if (args[0] === "--version") return probeOk("grok 0.9.4");
      if (args[0] === "--help") return probeOk("usage only");
      if (args[0] === "agent") return probeOk("agent help");
      return probeOk("");
    };
    const result = await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "0.9.4",
        expectedSha256: digest,
        expectedSizeBytes: content.length,
        target: "darwin-arm64",
        signingPolicy: { requirePlatformSignature: false },
        requiredCapabilities: ["teleport"],
        declaredCapabilities: [],
      },
      {
        runProbe,
        setExecutable: () => undefined,
        verifySignature: async () => ({ checked: false, valid: true }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("capability_missing");
  });

  it("rejects a declared capability that is absent from probe output", async () => {
    const runProbe: RunProbeFn = async (_b, args) => {
      if (args[0] === "--version") return probeOk("grok 0.9.4");
      if (args[0] === "--help") return probeOk("usage: grok\nagent");
      if (args[0] === "agent") return probeOk("agent help");
      return probeOk("");
    };
    const result = await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "0.9.4",
        expectedSha256: digest,
        expectedSizeBytes: content.length,
        target: "darwin-arm64",
        signingPolicy: { requirePlatformSignature: false },
        requiredCapabilities: ["managed-no-self-update"],
        declaredCapabilities: ["managed-no-self-update"],
      },
      {
        runProbe,
        setExecutable: () => undefined,
        verifySignature: async () => ({ checked: false, valid: true }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("capability_missing");
  });

  it("sets executable bit only after digest and signature (macOS)", async () => {
    const order: string[] = [];
    await verifyRuntimeBinary(
      {
        binaryPath,
        expectedVersion: "0.9.4",
        expectedSha256: digest,
        expectedSizeBytes: content.length,
        target: "darwin-arm64",
        signingPolicy: { requirePlatformSignature: true },
      },
      {
        platform: "darwin",
        runProbe: goodProbes(),
        verifySignature: async () => {
          order.push("signature");
          return goodSig;
        },
        setExecutable: () => {
          order.push("chmod");
        },
      },
    );
    expect(order.indexOf("signature")).toBeLessThan(order.indexOf("chmod"));
  });
});
