/**
 * Verify a managed Grok runtime binary before promotion:
 * size/SHA-256, platform signature, executable bit (macOS), non-billable probes.
 *
 * Probes: `--version`, `--help`, `agent --help` — each capped at 10s / 256 KiB.
 * Requires exact declared version and declared capabilities (e.g. managed-no-self-update).
 */
import {
  chmodSync,
  existsSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { CanonicalRuntimeTarget, SigningPolicy } from "@grokdesk/shared";
import {
  verifyPlatformSignature,
  type PlatformSignatureDeps,
  type RunCommandFn,
} from "./platform-signature.js";
import type {
  PlatformSigningResult,
  RuntimeProbeResult,
} from "./runtime-types.js";

export const PROBE_TIMEOUT_MS = 10_000;
export const PROBE_MAX_OUTPUT_BYTES = 256 * 1024;

export type ProbeRunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
};

export type RunProbeFn = (
  binaryPath: string,
  args: readonly string[],
  options?: { timeoutMs?: number; maxOutputBytes?: number },
) => Promise<ProbeRunResult>;

export type RuntimeVerifierDeps = {
  runProbe?: RunProbeFn;
  /** Platform signature check (inject to stub codesign/Authenticode). */
  verifySignature?: (
    input: {
      binaryPath: string;
      target: string;
      policy: SigningPolicy;
    },
    deps?: PlatformSignatureDeps,
  ) => Promise<PlatformSigningResult>;
  platform?: NodeJS.Platform;
  probeTimeoutMs?: number;
  probeMaxOutputBytes?: number;
  /** Test hook: skip or override chmod. */
  setExecutable?: (binaryPath: string) => void;
};

export type VerifyRuntimeInput = {
  binaryPath: string;
  expectedVersion: string;
  expectedSha256: string;
  expectedSizeBytes: number;
  target: CanonicalRuntimeTarget | string;
  signingPolicy: SigningPolicy;
  /** Capability tokens that must appear in probe output. */
  requiredCapabilities?: readonly string[];
  /**
   * Manifest-declared capabilities to look for in probe output. Declarations
   * are never accepted as evidence by themselves.
   */
  declaredCapabilities?: readonly string[];
};

export type VerifyRuntimeErrorCode =
  | "binary_missing"
  | "size_mismatch"
  | "digest_mismatch"
  | "signature_invalid"
  | "unsigned_required"
  | "executable_bit"
  | "probe_timeout"
  | "probe_failed"
  | "invalid_version"
  | "version_mismatch"
  | "capability_missing"
  | "agent_help_missing";

export type VerifyRuntimeResult =
  | {
      ok: true;
      digestSha256: string;
      sizeBytes: number;
      platformSigning: PlatformSigningResult;
      probes: RuntimeProbeResult[];
      capabilities: string[];
    }
  | {
      ok: false;
      code: VerifyRuntimeErrorCode;
      message: string;
      platformSigning?: PlatformSigningResult;
      probes?: RuntimeProbeResult[];
    };

function normalizeSha(hex: string): string {
  return hex.toLowerCase();
}

function isSha256Hex(v: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(v);
}

const SEMVER_SOURCE =
  "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)" +
  "(?:-(?:(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*))*))?" +
  "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
const EXACT_SEMVER_RE = new RegExp(`^${SEMVER_SOURCE}$`);
const PROBED_SEMVER_RE = new RegExp(
  `(?<![0-9A-Za-z-])${SEMVER_SOURCE}(?![0-9A-Za-z-])`,
  "g",
);

function isValidSemver(version: string): boolean {
  return EXACT_SEMVER_RE.test(version);
}

function probedVersions(text: string): string[] {
  return text.match(PROBED_SEMVER_RE) ?? [];
}

/** Streaming SHA-256 of a file (avoids buffering large binaries). */
export async function sha256FileStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * Default probe runner: spawn binary with arg array, cap time and output.
 */
export function defaultRunProbe(
  binaryPath: string,
  args: readonly string[],
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<ProbeRunResult> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const maxBytes = options.maxOutputBytes ?? PROBE_MAX_OUTPUT_BYTES;
  const started = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;

    const child = spawn(path.resolve(binaryPath), [...args], {
      stdio: ["ignore", "pipe", "pipe"],
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
        durationMs: Date.now() - started,
        timedOut,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* dead */
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
  });
}

function defaultSetExecutable(binaryPath: string, platform: NodeJS.Platform): void {
  if (platform === "win32") return;
  try {
    chmodSync(binaryPath, 0o755);
  } catch (err) {
    throw new Error(
      `executable_bit:${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function extractCapabilities(
  probeText: string,
  candidates: readonly string[],
): string[] {
  const found = new Set<string>();
  const normalizedProbe = probeText
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  for (const cap of candidates) {
    const normalizedCap = cap.toLowerCase().replace(/_/g, "-");
    const escaped = normalizedCap.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|-)${escaped}(?:$|-)`).test(normalizedProbe)) {
      found.add(cap);
    }
  }
  return [...found];
}

/**
 * Full pre-install verification of a runtime binary at `binaryPath`.
 */
export async function verifyRuntimeBinary(
  input: VerifyRuntimeInput,
  deps: RuntimeVerifierDeps = {},
): Promise<VerifyRuntimeResult> {
  const platform = deps.platform ?? process.platform;
  const runProbe = deps.runProbe ?? defaultRunProbe;
  const verifySignature = deps.verifySignature ?? verifyPlatformSignature;
  const probeTimeoutMs = deps.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  const probeMax = deps.probeMaxOutputBytes ?? PROBE_MAX_OUTPUT_BYTES;
  const binaryPath = path.resolve(input.binaryPath);

  if (!isValidSemver(input.expectedVersion)) {
    return {
      ok: false,
      code: "invalid_version",
      message: `expectedVersion is not valid SemVer: ${input.expectedVersion}`,
    };
  }

  if (!existsSync(binaryPath)) {
    return {
      ok: false,
      code: "binary_missing",
      message: `binary missing: ${binaryPath}`,
    };
  }

  let sizeBytes: number;
  try {
    sizeBytes = statSync(binaryPath).size;
  } catch (err) {
    return {
      ok: false,
      code: "binary_missing",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (sizeBytes !== input.expectedSizeBytes) {
    return {
      ok: false,
      code: "size_mismatch",
      message: `size ${sizeBytes} != expected ${input.expectedSizeBytes}`,
    };
  }

  if (!isSha256Hex(input.expectedSha256)) {
    return {
      ok: false,
      code: "digest_mismatch",
      message: "expectedSha256 is not 64 hex chars",
    };
  }

  let digest: string;
  try {
    digest = await sha256FileStream(binaryPath);
  } catch (err) {
    return {
      ok: false,
      code: "digest_mismatch",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (digest !== normalizeSha(input.expectedSha256)) {
    return {
      ok: false,
      code: "digest_mismatch",
      message: `digest mismatch: got ${digest}`,
    };
  }

  // Platform signature (injectable).
  const platformSigning = await verifySignature({
    binaryPath,
    target: String(input.target),
    policy: input.signingPolicy,
  });

  if (input.signingPolicy.requirePlatformSignature) {
    if (!platformSigning.checked) {
      return {
        ok: false,
        code: "unsigned_required",
        message: "platform signature required but not checked",
        platformSigning,
      };
    }
    if (!platformSigning.valid) {
      return {
        ok: false,
        code: "signature_invalid",
        message: platformSigning.detail ?? "platform signature invalid",
        platformSigning,
      };
    }
  } else if (platformSigning.checked && !platformSigning.valid) {
    // Optional signature was checked and failed — still reject.
    return {
      ok: false,
      code: "signature_invalid",
      message: platformSigning.detail ?? "platform signature invalid",
      platformSigning,
    };
  }

  // Executable bit only after digest + signature pass (macOS/Linux).
  try {
    if (deps.setExecutable) {
      deps.setExecutable(binaryPath);
    } else {
      defaultSetExecutable(binaryPath, platform);
    }
  } catch (err) {
    return {
      ok: false,
      code: "executable_bit",
      message: err instanceof Error ? err.message : String(err),
      platformSigning,
    };
  }

  const probes: RuntimeProbeResult[] = [];
  const probeSpecs: Array<{ name: string; args: string[] }> = [
    { name: "version", args: ["--version"] },
    { name: "help", args: ["--help"] },
    { name: "agent_help", args: ["agent", "--help"] },
  ];

  let combinedText = "";
  let versionText = "";
  for (const spec of probeSpecs) {
    const result = await runProbe(binaryPath, spec.args, {
      timeoutMs: probeTimeoutMs,
      maxOutputBytes: probeMax,
    });
    const summary = truncate(
      `${result.stdout}\n${result.stderr}`.trim(),
      512,
    );
    combinedText += `\n${result.stdout}\n${result.stderr}`;
    if (spec.name === "version") {
      versionText = `${result.stdout}\n${result.stderr}`;
    }

    if (result.timedOut) {
      probes.push({
        name: spec.name,
        ok: false,
        summary: "timeout",
        durationMs: result.durationMs,
      });
      return {
        ok: false,
        code: "probe_timeout",
        message: `probe timed out: ${spec.name}`,
        platformSigning,
        probes,
      };
    }

    // Cap enforcement: if output was truncated at max, treat as failure.
    if (
      result.stdout.length >= probeMax ||
      result.stderr.length >= probeMax
    ) {
      probes.push({
        name: spec.name,
        ok: false,
        summary: "output_cap_exceeded",
        durationMs: result.durationMs,
      });
      return {
        ok: false,
        code: "probe_failed",
        message: `probe output exceeded cap: ${spec.name}`,
        platformSigning,
        probes,
      };
    }

    if (result.code !== 0) {
      probes.push({
        name: spec.name,
        ok: false,
        summary: summary || `exit_${result.code ?? "null"}`,
        durationMs: result.durationMs,
      });
      if (spec.name === "agent_help") {
        return {
          ok: false,
          code: "agent_help_missing",
          message: "agent --help failed or missing",
          platformSigning,
          probes,
        };
      }
      return {
        ok: false,
        code: "probe_failed",
        message: `probe failed: ${spec.name}`,
        platformSigning,
        probes,
      };
    }

    probes.push({
      name: spec.name,
      ok: true,
      summary,
      durationMs: result.durationMs,
    });
  }

  // The version probe must contain the exact expected SemVer token.
  if (!probedVersions(versionText).includes(input.expectedVersion)) {
    return {
      ok: false,
      code: "version_mismatch",
      message: `version probe did not report exact version ${input.expectedVersion}`,
      platformSigning,
      probes,
    };
  }

  const declared = input.declaredCapabilities ?? input.requiredCapabilities ?? [];
  const required = input.requiredCapabilities ?? declared;
  const candidates = [...new Set([...declared, ...required])];
  const capabilities = extractCapabilities(combinedText, candidates);

  for (const cap of required) {
    if (!capabilities.includes(cap)) {
      return {
        ok: false,
        code: "capability_missing",
        message: `missing capability: ${cap}`,
        platformSigning,
        probes,
      };
    }
  }

  return {
    ok: true,
    digestSha256: digest,
    sizeBytes,
    platformSigning,
    probes,
    capabilities,
  };
}

/** Re-export for callers that only need the signature surface. */
export type { RunCommandFn };
