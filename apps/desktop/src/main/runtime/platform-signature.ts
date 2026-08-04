/**
 * Platform code-signing verification for managed Grok runtime binaries.
 *
 * macOS: `codesign --verify --strict`, extract Team ID / designated requirement,
 * then `spctl -a -t exec`. Windows: Authenticode via PowerShell
 * `Get-AuthenticodeSignature` with a literal path (no shell interpolation).
 *
 * All external tools are invoked with argument arrays. Output and wall-clock
 * time are capped. Inject {@link PlatformSignatureDeps.runCommand} in tests.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import type { SigningPolicy } from "@grokdesk/shared";
import type { PlatformSigningResult } from "./runtime-types.js";

export const PLATFORM_SIGNATURE_TIMEOUT_MS = 15_000;
export const PLATFORM_SIGNATURE_MAX_OUTPUT_BYTES = 64 * 1024;

export type RunCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type RunCommandFn = (
  command: string,
  args: readonly string[],
  options?: { timeoutMs?: number; maxOutputBytes?: number; input?: string },
) => Promise<RunCommandResult>;

export type PlatformSignatureDeps = {
  /** Override process runner (tests / non-host tools). */
  runCommand?: RunCommandFn;
  /** Host platform override. Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type PlatformSignatureInput = {
  binaryPath: string;
  /** Canonical target or any string starting with darwin/win32. */
  target: string;
  policy: SigningPolicy;
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

/**
 * Spawn a process with an argument array (never a shell). Caps stdout/stderr
 * and wall-clock time. Suitable for codesign/spctl/powershell.
 */
export function defaultRunCommand(
  command: string,
  args: readonly string[],
  options: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    input?: string;
  } = {},
): Promise<RunCommandResult> {
  const timeoutMs = options.timeoutMs ?? PLATFORM_SIGNATURE_TIMEOUT_MS;
  const maxBytes = options.maxOutputBytes ?? PLATFORM_SIGNATURE_MAX_OUTPUT_BYTES;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;

    const child = spawn(command, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: truncate(stdout, maxBytes),
        stderr: truncate(stderr, maxBytes),
        timedOut,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      finish(null);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stdoutBytes >= maxBytes) return;
      const take = buf.subarray(0, Math.max(0, maxBytes - stdoutBytes));
      stdoutBytes += take.length;
      stdout += take.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stderrBytes >= maxBytes) return;
      const take = buf.subarray(0, Math.max(0, maxBytes - stderrBytes));
      stderrBytes += take.length;
      stderr += take.toString("utf8");
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));

    if (options.input !== undefined && child.stdin) {
      child.stdin.end(options.input);
    } else {
      child.stdin?.end();
    }
  });
}

function isDarwinTarget(target: string, platform: NodeJS.Platform): boolean {
  return target.startsWith("darwin") || (target === "" && platform === "darwin");
}

function isWinTarget(target: string, platform: NodeJS.Platform): boolean {
  return target.startsWith("win32") || (target === "" && platform === "win32");
}

/** Parse `TeamIdentifier=XXXX` from `codesign -dv` stderr/stdout. */
export function parseMacTeamId(codesignVerboseOutput: string): string | undefined {
  const m = codesignVerboseOutput.match(/TeamIdentifier\s*=\s*([A-Z0-9]+)/i);
  return m?.[1];
}

/** Parse designated requirement blob text from `codesign -d -r-`. */
export function parseMacDesignatedRequirement(output: string): string | undefined {
  // codesign -d -r- prints: `designated => <requirement>`
  const m = output.match(/designated\s*=>\s*(.+)/i);
  if (!m?.[1]) return undefined;
  return m[1].trim();
}

/**
 * Extract Authenticode fields from a simple JSON blob emitted by our PowerShell helper.
 */
export function parseAuthenticodeJson(raw: string): {
  status?: string;
  subject?: string;
  thumbprint?: string;
} {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...(typeof o.Status === "string" ? { status: o.Status } : {}),
      ...(typeof o.status === "string" ? { status: o.status } : {}),
      ...(typeof o.Subject === "string" ? { subject: o.Subject } : {}),
      ...(typeof o.subject === "string" ? { subject: o.subject } : {}),
      ...(typeof o.Thumbprint === "string"
        ? { thumbprint: o.Thumbprint.toLowerCase() }
        : {}),
      ...(typeof o.thumbprint === "string"
        ? { thumbprint: o.thumbprint.toLowerCase() }
        : {}),
    };
  } catch {
    return {};
  }
}

async function verifyMacos(
  binaryPath: string,
  policy: SigningPolicy,
  run: RunCommandFn,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<PlatformSigningResult> {
  if (!policy.requirePlatformSignature) {
    return {
      checked: false,
      valid: true,
      detail: "platform_signature_not_required",
    };
  }

  const abs = path.resolve(binaryPath);
  const verify = await run("codesign", ["--verify", "--strict", abs], {
    timeoutMs,
    maxOutputBytes,
  });
  if (verify.timedOut) {
    return {
      checked: true,
      valid: false,
      detail: "codesign_verify_timeout",
    };
  }
  if (verify.code !== 0) {
    return {
      checked: true,
      valid: false,
      detail: truncate(
        `codesign_verify_failed:${verify.stderr || verify.stdout || "exit"}`,
        256,
      ),
    };
  }

  const verbose = await run(
    "codesign",
    ["-dv", "--verbose=4", abs],
    { timeoutMs, maxOutputBytes },
  );
  // codesign -dv writes identity details to stderr.
  const identityBlob = `${verbose.stderr}\n${verbose.stdout}`;
  const teamId = parseMacTeamId(identityBlob);

  if (policy.macTeamId && teamId !== policy.macTeamId) {
    return {
      checked: true,
      valid: false,
      teamId,
      detail: `wrong_team_id:expected=${policy.macTeamId}:got=${teamId ?? "none"}`,
    };
  }

  if (policy.macDesignatedRequirement) {
    const reqOut = await run("codesign", ["-d", "-r-", abs], {
      timeoutMs,
      maxOutputBytes,
    });
    const designatedRequirement = parseMacDesignatedRequirement(
      `${reqOut.stdout}\n${reqOut.stderr}`,
    );
    // Accept exact match or containment of the required requirement text.
    const ok =
      designatedRequirement === policy.macDesignatedRequirement ||
      (designatedRequirement?.includes(policy.macDesignatedRequirement) ??
        false);
    if (!ok) {
      return {
        checked: true,
        valid: false,
        teamId,
        detail: "designated_requirement_mismatch",
      };
    }
  }

  const spctl = await run("spctl", ["-a", "-t", "exec", "-v", abs], {
    timeoutMs,
    maxOutputBytes,
  });
  if (spctl.timedOut) {
    return {
      checked: true,
      valid: false,
      teamId,
      detail: "spctl_timeout",
    };
  }
  if (spctl.code !== 0) {
    return {
      checked: true,
      valid: false,
      teamId,
      detail: truncate(
        `spctl_failed:${spctl.stderr || spctl.stdout || "exit"}`,
        256,
      ),
    };
  }

  return {
    checked: true,
    valid: true,
    ...(teamId ? { teamId } : {}),
    detail: "macos_codesign_spctl_ok",
  };
}

/**
 * PowerShell script body: path is passed via stdin as a single line to avoid
 * argument-injection into the shell. Never interpolates the path into -Command.
 */
export const WINDOWS_AUTHENTICODE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$path = [Console]::In.ReadLine()",
  "if ([string]::IsNullOrWhiteSpace($path)) { throw 'empty path' }",
  "$sig = Get-AuthenticodeSignature -LiteralPath $path",
  "$subject = $null",
  "if ($sig.SignerCertificate) { $subject = $sig.SignerCertificate.Subject }",
  "$thumb = $null",
  "if ($sig.SignerCertificate) { $thumb = $sig.SignerCertificate.Thumbprint }",
  "@{ Status = [string]$sig.Status; Subject = $subject; Thumbprint = $thumb } | ConvertTo-Json -Compress",
].join("; ");

async function verifyWindows(
  binaryPath: string,
  policy: SigningPolicy,
  run: RunCommandFn,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<PlatformSigningResult> {
  if (!policy.requirePlatformSignature) {
    return {
      checked: false,
      valid: true,
      detail: "platform_signature_not_required",
    };
  }

  const abs = path.resolve(binaryPath);
  // Prefer pwsh, fall back to Windows PowerShell.
  const psCandidates = ["pwsh", "powershell"];
  let result: RunCommandResult | null = null;
  for (const ps of psCandidates) {
    result = await run(
      ps,
      ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_AUTHENTICODE_SCRIPT],
      { timeoutMs, maxOutputBytes, input: `${abs}\n` },
    );
    if (!result.timedOut && result.code !== null) break;
  }
  if (!result || result.timedOut) {
    return {
      checked: true,
      valid: false,
      detail: "authenticode_timeout",
    };
  }
  if (result.code !== 0) {
    return {
      checked: true,
      valid: false,
      detail: truncate(
        `authenticode_invoke_failed:${result.stderr || result.stdout || "exit"}`,
        256,
      ),
    };
  }

  const parsed = parseAuthenticodeJson(result.stdout.trim());
  const status = parsed.status;
  if (status !== "Valid") {
    return {
      checked: true,
      valid: false,
      status: status ?? "Unknown",
      subject: parsed.subject,
      thumbprint: parsed.thumbprint,
      detail: `authenticode_status:${status ?? "missing"}`,
    };
  }

  if (
    policy.windowsThumbprint &&
    (parsed.thumbprint ?? "").toLowerCase() !==
      policy.windowsThumbprint.toLowerCase()
  ) {
    return {
      checked: true,
      valid: false,
      status,
      subject: parsed.subject,
      thumbprint: parsed.thumbprint,
      detail: "thumbprint_mismatch",
    };
  }

  if (
    policy.windowsSubject &&
    !(parsed.subject ?? "").includes(policy.windowsSubject)
  ) {
    return {
      checked: true,
      valid: false,
      status,
      subject: parsed.subject,
      thumbprint: parsed.thumbprint,
      detail: "subject_mismatch",
    };
  }

  return {
    checked: true,
    valid: true,
    status,
    subject: parsed.subject,
    thumbprint: parsed.thumbprint,
    detail: "windows_authenticode_ok",
  };
}

/**
 * Verify platform signature for a staged or installed binary against manifest policy.
 * When policy does not require a signature, returns `{ checked: false, valid: true }`.
 * Unsupported targets with `requirePlatformSignature` fail closed.
 */
export async function verifyPlatformSignature(
  input: PlatformSignatureInput,
  deps: PlatformSignatureDeps = {},
): Promise<PlatformSigningResult> {
  const platform = deps.platform ?? process.platform;
  const run = deps.runCommand ?? defaultRunCommand;
  const timeoutMs = deps.timeoutMs ?? PLATFORM_SIGNATURE_TIMEOUT_MS;
  const maxOutputBytes =
    deps.maxOutputBytes ?? PLATFORM_SIGNATURE_MAX_OUTPUT_BYTES;
  const { binaryPath, target, policy } = input;

  if (!policy.requirePlatformSignature) {
    return {
      checked: false,
      valid: true,
      detail: "platform_signature_not_required",
    };
  }

  if (isDarwinTarget(target, platform)) {
    return verifyMacos(binaryPath, policy, run, timeoutMs, maxOutputBytes);
  }
  if (isWinTarget(target, platform)) {
    return verifyWindows(binaryPath, policy, run, timeoutMs, maxOutputBytes);
  }

  return {
    checked: true,
    valid: false,
    detail: `unsupported_target_for_signature:${target || platform}`,
  };
}
