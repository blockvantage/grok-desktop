import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseAuthenticodeJson,
  parseMacDesignatedRequirement,
  parseMacTeamId,
  verifyPlatformSignature,
  WINDOWS_AUTHENTICODE_SCRIPT,
  type RunCommandFn,
  type RunCommandResult,
} from "./platform-signature.js";

function ok(stdout = "", stderr = ""): RunCommandResult {
  return { code: 0, stdout, stderr, timedOut: false };
}

function fail(stderr = "fail"): RunCommandResult {
  return { code: 1, stdout: "", stderr, timedOut: false };
}

describe("platform-signature parsers", () => {
  it("parses macOS TeamIdentifier", () => {
    expect(
      parseMacTeamId("TeamIdentifier=ABCD123456\nAuthority=Developer ID"),
    ).toBe("ABCD123456");
    expect(parseMacTeamId("no team")).toBeUndefined();
  });

  it("parses designated requirement", () => {
    expect(
      parseMacDesignatedRequirement(
        "designated => identifier \"com.xai.grok\" and anchor apple",
      ),
    ).toBe('identifier "com.xai.grok" and anchor apple');
  });

  it("parses Authenticode JSON", () => {
    expect(
      parseAuthenticodeJson(
        JSON.stringify({
          Status: "Valid",
          Subject: "CN=xAI",
          Thumbprint: "AABBCC",
        }),
      ),
    ).toEqual({
      status: "Valid",
      subject: "CN=xAI",
      thumbprint: "aabbcc",
    });
  });

  it("Authenticode script uses LiteralPath and stdin path", () => {
    expect(WINDOWS_AUTHENTICODE_SCRIPT).toContain("Get-AuthenticodeSignature");
    expect(WINDOWS_AUTHENTICODE_SCRIPT).toContain("-LiteralPath");
    expect(WINDOWS_AUTHENTICODE_SCRIPT).toContain("ReadLine");
    // Must not embed a caller-controlled path placeholder that invites interpolation.
    expect(WINDOWS_AUTHENTICODE_SCRIPT).not.toContain("$args[");
  });
});

describe("verifyPlatformSignature", () => {
  it("skips checks when policy does not require signature", async () => {
    const run = vi.fn<RunCommandFn>();
    const result = await verifyPlatformSignature(
      {
        binaryPath: "/tmp/grok",
        target: "darwin-arm64",
        policy: { requirePlatformSignature: false },
      },
      { runCommand: run, platform: "darwin" },
    );
    expect(result).toMatchObject({ checked: false, valid: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts macOS binary with matching Team ID and spctl", async () => {
    const run: RunCommandFn = async (cmd, args) => {
      if (cmd === "codesign" && args[0] === "--verify") return ok();
      if (cmd === "codesign" && args[0] === "-dv") {
        return ok("", "TeamIdentifier=TEAMID001\n");
      }
      if (cmd === "spctl") return ok("", "accepted");
      return fail(`unexpected ${cmd}`);
    };
    const result = await verifyPlatformSignature(
      {
        binaryPath: "/tmp/grok",
        target: "darwin-arm64",
        policy: {
          requirePlatformSignature: true,
          macTeamId: "TEAMID001",
        },
      },
      { runCommand: run, platform: "darwin" },
    );
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(true);
    expect(result.teamId).toBe("TEAMID001");
  });

  it("rejects macOS wrong Team ID", async () => {
    const run: RunCommandFn = async (cmd, args) => {
      if (cmd === "codesign" && args[0] === "--verify") return ok();
      if (cmd === "codesign" && args[0] === "-dv") {
        return ok("", "TeamIdentifier=WRONGTEAM\n");
      }
      return ok();
    };
    const result = await verifyPlatformSignature(
      {
        binaryPath: "/tmp/grok",
        target: "darwin-arm64",
        policy: {
          requirePlatformSignature: true,
          macTeamId: "TEAMID001",
        },
      },
      { runCommand: run, platform: "darwin" },
    );
    expect(result.valid).toBe(false);
    expect(result.detail).toContain("wrong_team_id");
  });

  it("rejects macOS designated requirement mismatch", async () => {
    const run: RunCommandFn = async (cmd, args) => {
      if (cmd === "codesign" && args[0] === "--verify") return ok();
      if (cmd === "codesign" && args[0] === "-dv") {
        return ok("", "TeamIdentifier=TEAMID001\n");
      }
      if (cmd === "codesign" && args[0] === "-d") {
        return ok('designated => identifier "com.evil.app"\n');
      }
      return ok();
    };
    const result = await verifyPlatformSignature(
      {
        binaryPath: "/tmp/grok",
        target: "darwin-arm64",
        policy: {
          requirePlatformSignature: true,
          macTeamId: "TEAMID001",
          macDesignatedRequirement: 'identifier "com.xai.grok"',
        },
      },
      { runCommand: run, platform: "darwin" },
    );
    expect(result.valid).toBe(false);
    expect(result.detail).toBe("designated_requirement_mismatch");
  });

  it("rejects unsigned macOS when required", async () => {
    const run: RunCommandFn = async () => fail("code object is not signed");
    const result = await verifyPlatformSignature(
      {
        binaryPath: "/tmp/grok",
        target: "darwin-arm64",
        policy: { requirePlatformSignature: true },
      },
      { runCommand: run, platform: "darwin" },
    );
    expect(result.valid).toBe(false);
    expect(result.detail).toContain("codesign_verify_failed");
  });

  it("uses absolute path args without shell for codesign", async () => {
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const run: RunCommandFn = async (cmd, args) => {
      calls.push({ cmd, args: [...args] });
      if (cmd === "codesign" && args[0] === "--verify") return ok();
      if (cmd === "codesign" && args[0] === "-dv") {
        return ok("", "TeamIdentifier=T1\n");
      }
      if (cmd === "spctl") return ok();
      return ok();
    };
    const bin = path.join("/tmp", "nested", "grok");
    await verifyPlatformSignature(
      {
        binaryPath: bin,
        target: "darwin-x64",
        policy: { requirePlatformSignature: true, macTeamId: "T1" },
      },
      { runCommand: run, platform: "darwin" },
    );
    const verifyCall = calls.find(
      (c) => c.cmd === "codesign" && c.args[0] === "--verify",
    );
    expect(verifyCall?.args).toEqual(["--verify", "--strict", path.resolve(bin)]);
  });

  it("accepts Windows Authenticode Valid status + thumbprint/subject", async () => {
    const run: RunCommandFn = async (cmd, _args, opts) => {
      expect(cmd === "pwsh" || cmd === "powershell").toBe(true);
      expect(opts?.input).toContain("grok.exe");
      return ok(
        JSON.stringify({
          Status: "Valid",
          Subject: "CN=xAI Inc, O=xAI",
          Thumbprint: "DEADBEEF",
        }),
      );
    };
    const result = await verifyPlatformSignature(
      {
        binaryPath: "C:\\Apps\\grok.exe",
        target: "win32-x64",
        policy: {
          requirePlatformSignature: true,
          windowsThumbprint: "deadbeef",
          windowsSubject: "CN=xAI Inc",
        },
      },
      { runCommand: run, platform: "win32" },
    );
    expect(result.valid).toBe(true);
    expect(result.status).toBe("Valid");
    expect(result.thumbprint).toBe("deadbeef");
  });

  it("rejects Windows invalid status", async () => {
    const run: RunCommandFn = async () =>
      ok(JSON.stringify({ Status: "NotSigned", Subject: null, Thumbprint: null }));
    const result = await verifyPlatformSignature(
      {
        binaryPath: "C:\\Apps\\grok.exe",
        target: "win32-x64",
        policy: { requirePlatformSignature: true },
      },
      { runCommand: run, platform: "win32" },
    );
    expect(result.valid).toBe(false);
    expect(result.detail).toContain("authenticode_status");
  });

  it("rejects Windows thumbprint mismatch", async () => {
    const run: RunCommandFn = async () =>
      ok(
        JSON.stringify({
          Status: "Valid",
          Subject: "CN=xAI",
          Thumbprint: "AAAA",
        }),
      );
    const result = await verifyPlatformSignature(
      {
        binaryPath: "C:\\Apps\\grok.exe",
        target: "win32-x64",
        policy: {
          requirePlatformSignature: true,
          windowsThumbprint: "BBBB",
        },
      },
      { runCommand: run, platform: "win32" },
    );
    expect(result.valid).toBe(false);
    expect(result.detail).toBe("thumbprint_mismatch");
  });

  it("rejects Windows subject mismatch", async () => {
    const run: RunCommandFn = async () =>
      ok(
        JSON.stringify({
          Status: "Valid",
          Subject: "CN=Evil Corp",
          Thumbprint: "AAAA",
        }),
      );
    const result = await verifyPlatformSignature(
      {
        binaryPath: "C:\\Apps\\grok.exe",
        target: "win32-x64",
        policy: {
          requirePlatformSignature: true,
          windowsSubject: "CN=xAI",
        },
      },
      { runCommand: run, platform: "win32" },
    );
    expect(result.valid).toBe(false);
    expect(result.detail).toBe("subject_mismatch");
  });
});
