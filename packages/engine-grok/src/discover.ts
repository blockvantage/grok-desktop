import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFileAsync = promisify(execFile);

/** Path helpers for the *logical* platform (may differ from the host OS in tests). */
function pathFor(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * JS CLI fixtures (`.mjs`/`.cjs`/`.js`) must be launched via `node` — Windows has no
 * shebang support, and `execFile`/`spawn` of a script path fails without a PE binary.
 */
export function isJsCliBinary(binary: string): boolean {
  return /\.(mjs|cjs|js)$/i.test(binary);
}

/**
 * Resolve command + argv for a Grok CLI binary. JS fixtures run under `process.execPath`.
 */
export function cliCommand(
  binary: string,
  args: string[] = [],
): { command: string; args: string[] } {
  if (isJsCliBinary(binary)) {
    return { command: process.execPath, args: [binary, ...args] };
  }
  return { command: binary, args };
}

/** `execFile` wrapper that launches JS fixtures via Node on every platform. */
export async function execGrokCli(
  binary: string,
  args: string[],
  opts: Parameters<typeof execFileAsync>[2] = {},
): Promise<{ stdout: string; stderr: string }> {
  const { command, args: argv } = cliCommand(binary, args);
  const result = await execFileAsync(command, argv, opts);
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    // On Windows, X_OK is effectively F_OK (no Unix execute bit). Existence is enough
    // for managed `.exe` / extensionless paths; callers still filter by name.
    await access(p, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Directories where a user-installed Grok CLI is commonly found.
 * Used only by {@link findGlobalGrokBinary} diagnostics — never for production.
 */
export function grokInstallDirs(
  home: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const p = pathFor(platform);
  if (platform === "win32") {
    return [
      p.join(home, "AppData", "Local", "grok"),
      p.join(home, ".grok", "bin"),
      p.join(home, ".local", "bin"),
    ];
  }
  return [
    p.join(home, ".grok", "bin"),
    p.join(home, ".local", "bin"),
    "/usr/local/bin",
    p.join(home, "bin"),
  ];
}

/**
 * Prepend only the directory of an explicit managed (or fixture) binary.
 * Does not inject ~/.grok/bin or other global install locations.
 */
export function envWithManagedBinary(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const sep = platform === "win32" ? ";" : ":";
  const p = pathFor(platform);
  // Prefer platform-native path math so unit tests can pass platform ≠ host OS.
  const abs = p.isAbsolute(binary) ? p.normalize(binary) : p.resolve(binary);
  const dir = p.dirname(abs);
  const current = env.PATH || env.Path || "";
  const parts = current.split(sep).filter(Boolean);
  const merged = [dir, ...parts.filter((part) => part !== dir)];
  return {
    ...env,
    PATH: merged.join(sep),
    HOME: env.HOME || home,
    ...(platform === "win32" && !env.USERPROFILE
      ? { USERPROFILE: home }
      : {}),
  };
}

/**
 * @deprecated Diagnostics / legacy probes only. Prefer {@link envWithManagedBinary}.
 * Prepends common global install dirs — never use for production engine spawn PATH.
 */
export function envWithGrokPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const sep = platform === "win32" ? ";" : ":";
  const extras = grokInstallDirs(home, platform);
  const current = env.PATH || env.Path || "";
  const parts = current.split(sep).filter(Boolean);
  const merged = [...extras.filter((d) => !parts.includes(d)), ...parts];
  return {
    ...env,
    PATH: merged.join(sep),
    HOME: env.HOME || home,
    ...(platform === "win32" && !env.USERPROFILE
      ? { USERPROFILE: home }
      : {}),
  };
}

function isAbsolutePath(p: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") {
    return path.win32.isAbsolute(p);
  }
  return path.posix.isAbsolute(p) || path.isAbsolute(p);
}

/**
 * Production binary selection for Desk-managed Grok.
 *
 * Accepts an explicit absolute path from:
 * - `managedBinaryPath` option
 * - `GROKDESK_DEV_GROK_BINARY` when unpackaged OR when `GROKDESK_DEV_UNLOCK=1`
 *   (review / `make local` unlock builds)
 *
 * Production packaged releases (no unlock) never PATH-discover a global install.
 * Unlock builds may fall back to {@link findGlobalGrokBinary} so a local
 * `~/.grok/bin/grok` works without a managed-runtime download.
 */
export async function resolveManagedGrokBinary(opts?: {
  managedBinaryPath?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<string | null> {
  const env = opts?.env ?? process.env;
  const platform = opts?.platform ?? process.platform;
  const unpackaged = env.GROKDESK_PACKAGED === "0";
  const unlock = env.GROKDESK_DEV_UNLOCK === "1";

  const candidates: string[] = [];
  const explicit = opts?.managedBinaryPath?.trim();
  if (explicit) candidates.push(explicit);
  if (unpackaged || unlock) {
    const dev = env.GROKDESK_DEV_GROK_BINARY?.trim();
    if (dev) candidates.push(dev);
  }

  for (const c of candidates) {
    if (!isAbsolutePath(c, platform)) continue;
    // Normalize so callers always get a resolved absolute path.
    const abs =
      platform === "win32" ? path.win32.resolve(c) : path.resolve(c);
    if (await isExecutable(abs)) return abs;
  }

  if (unlock) {
    return findGlobalGrokBinary(env, platform);
  }
  return null;
}

/**
 * Diagnostics only: locate a user-global Grok CLI.
 * Never use for production engine, auth, dictation, or title generation.
 */
export async function findGlobalGrokBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  // Intentionally still honors GROK_BUILD_PATH for diagnostics / developer tooling.
  if (env.GROK_BUILD_PATH && (await isExecutable(env.GROK_BUILD_PATH))) {
    return env.GROK_BUILD_PATH;
  }

  const enriched = envWithGrokPath(env, platform);

  try {
    const cmd = platform === "win32" ? "where" : "which";
    const bin = platform === "win32" ? "grok.exe" : "grok";
    const { stdout } = await execFileAsync(cmd, [bin], {
      env: enriched,
    });
    const first = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (first && (await isExecutable(first))) return first;
  } catch {
    // continue to candidate paths
  }

  const home = env.HOME || env.USERPROFILE || os.homedir() || "";
  const binName = platform === "win32" ? "grok.exe" : "grok";
  // Host `path.join` so filesystem probes work when tests pass a foreign platform
  // (logical PATH construction uses pathFor via grokInstallDirs).
  const relativeTails: string[][] =
    platform === "win32"
      ? [
          ["AppData", "Local", "grok"],
          [".grok", "bin"],
          [".local", "bin"],
        ]
      : [[".grok", "bin"], [".local", "bin"], ["bin"]];
  const candidates = relativeTails.map((parts) =>
    path.join(home, ...parts, binName),
  );
  if (platform !== "win32") {
    candidates.push(path.join("/usr/local/bin", binName));
  }
  if (platform === "win32") {
    candidates.push(path.join(home, "AppData", "Local", "grok", "grok.exe"));
  }

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }

  return null;
}

/**
 * @deprecated Use {@link findGlobalGrokBinary} for diagnostics or
 * {@link resolveManagedGrokBinary} for production selection.
 */
export const findGrokBinary = findGlobalGrokBinary;

/** Minimum managed CLI version Desk will spawn as ACP. */
export const MIN_MANAGED_CLI_VERSION = "1.0.0";

/** Compare dotted versions (major.minor.patch). Pre-release suffixes ignored. */
export function cliVersionAtLeast(
  version: string | null | undefined,
  minimum: string = MIN_MANAGED_CLI_VERSION,
): boolean {
  if (!version) return false;
  const parse = (v: string): number[] =>
    v
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => {
        const x = Number.parseInt(n, 10);
        return Number.isFinite(x) ? x : 0;
      });
  const a = parse(version);
  const b = parse(minimum);
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

export interface GrokCliProbe {
  binary: string;
  /** Parsed semver-ish version string when available. */
  version: string | null;
  rawVersionOutput: string;
  /** CLI accepts deterministic scripting flag (best-effort parse of help/version). */
  supportsNoAutoUpdate: boolean;
  /** Documented sandbox flags appear in help. */
  supportsSandbox: boolean;
  /** `grok agent stdio` appears available. */
  supportsAgentStdio: boolean;
}

/**
 * Probe CLI version and capability surface before task start.
 * Does not submit paid work — only version/help.
 * PATH is limited to the binary's directory (no global install injection).
 */
export async function probeGrokCli(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GrokCliProbe> {
  const enriched = envWithManagedBinary(binary, env);
  let rawVersionOutput = "";
  let version: string | null = null;
  try {
    const { stdout, stderr } = await execGrokCli(binary, ["--version"], {
      env: enriched,
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    rawVersionOutput = `${stdout ?? ""}${stderr ?? ""}`.trim();
    const m = rawVersionOutput.match(
      /\b(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?)\b/,
    );
    version = m?.[1] ?? null;
  } catch (e) {
    rawVersionOutput = e instanceof Error ? e.message : String(e);
  }

  let help = "";
  try {
    const { stdout, stderr } = await execGrokCli(binary, ["--help"], {
      env: enriched,
      timeout: 5_000,
      maxBuffer: 256 * 1024,
    });
    help = `${stdout ?? ""}${stderr ?? ""}`.toLowerCase();
  } catch {
    /* ignore */
  }

  let agentHelp = "";
  try {
    const { stdout, stderr } = await execGrokCli(binary, ["agent", "--help"], {
      env: enriched,
      timeout: 5_000,
      maxBuffer: 128 * 1024,
    });
    agentHelp = `${stdout ?? ""}${stderr ?? ""}`.toLowerCase();
  } catch {
    /* ignore */
  }

  const combined = `${help}\n${agentHelp}\n${rawVersionOutput.toLowerCase()}`;
  return {
    binary,
    version,
    rawVersionOutput,
    supportsNoAutoUpdate:
      combined.includes("no-auto-update") ||
      combined.includes("no_auto_update"),
    supportsSandbox: combined.includes("sandbox"),
    supportsAgentStdio:
      agentHelp.includes("stdio") || combined.includes("agent stdio"),
  };
}
