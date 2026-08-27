import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  cliCommand,
  envWithManagedBinary,
  execGrokCli,
  resolveManagedGrokBinary,
} from "./discover.js";
import type { EngineStatus } from "./types.js";

export interface GrokAuthStatus {
  signedIn: boolean;
  accountLabel: string | null;
  /** Human display name (first/last) when the SuperGrok profile exposes it. */
  accountName: string | null;
  needsReauth: boolean;
  engineStatus: EngineStatus;
  binaryPath: string | null;
  models: string[];
  defaultModel: string | null;
}

interface AuthJsonEntry {
  email?: string;
  first_name?: string;
  last_name?: string;
  expires_at?: string;
  /** Access token (Grok Build stores this as `key`). Never returned to callers. */
  key?: string;
  access_token?: string;
  /** Long-lived refresh token — session should persist across app restarts. */
  refresh_token?: string;
  auth_mode?: string;
  user_id?: string;
}

export interface AuthFileMetadata {
  /** True when a reusable SuperGrok session exists (refresh token or live access token). */
  signedIn: boolean;
  accountLabel: string | null;
  /** Display name from the profile (first/last), independent of the email label. */
  accountName: string | null;
  /** Access token past expires_at (refresh may still be valid). */
  accessExpired: boolean;
  /** True only when there is no refresh token and access is gone/expired. */
  needsLogin: boolean;
  hasRefreshToken: boolean;
}

function accountLabelFrom(entry: AuthJsonEntry): string {
  return (
    entry.email ||
    [entry.first_name, entry.last_name].filter(Boolean).join(" ") ||
    "SuperGrok user"
  );
}

/** Friendly display name (first/last) when present; null so callers can fall back. */
function accountNameFrom(entry: AuthJsonEntry): string | null {
  const full = [entry.first_name, entry.last_name].filter(Boolean).join(" ");
  return full || null;
}

/**
 * Read ~/.grok/auth.json metadata only (never returns tokens).
 *
 * SuperGrok OAuth stores a short-lived access token (`key` / expires_at ~hours)
 * plus a long-lived `refresh_token`. Presence of a refresh token means the user
 * is still signed in — the CLI refreshes access automatically. We must not treat
 * access expiry as "signed out" or the desktop app will re-prompt every open.
 */
export async function readAuthFileMetadata(
  home: string = os.homedir(),
): Promise<AuthFileMetadata> {
  const authPath = path.join(home, ".grok", "auth.json");
  try {
    const raw = await fs.readFile(authPath, "utf8");
    const data = JSON.parse(raw) as Record<string, AuthJsonEntry>;
    const entries = Object.values(data).filter(
      (e) => e && typeof e === "object",
    );
    if (entries.length === 0) {
      return {
        signedIn: false,
        accountLabel: null,
        accountName: null,
        accessExpired: false,
        needsLogin: true,
        hasRefreshToken: false,
      };
    }

    // Prefer the entry that still has a refresh token / identity.
    const ranked = [...entries].sort((a, b) => {
      const score = (e: AuthJsonEntry) =>
        (e.refresh_token ? 4 : 0) +
        (e.key || e.access_token ? 2 : 0) +
        (e.email ? 1 : 0);
      return score(b) - score(a);
    });
    const first = ranked[0]!;

    const hasRefreshToken = Boolean(
      first.refresh_token && String(first.refresh_token).length > 0,
    );
    const hasAccessToken = Boolean(first.key || first.access_token);
    const hasIdentity = Boolean(
      first.email || first.user_id || first.first_name,
    );

    let accessExpired = false;
    if (first.expires_at) {
      const exp = Date.parse(first.expires_at);
      if (!Number.isNaN(exp) && exp < Date.now()) accessExpired = true;
    }

    // Persistent session requires a real credential.
    // Identity + expires_at alone is NOT signed-in (stale profile after logout).
    const signedIn =
      hasRefreshToken || (hasAccessToken && !accessExpired);

    const needsLogin = !signedIn;

    return {
      signedIn,
      accountLabel: hasIdentity || signedIn ? accountLabelFrom(first) : null,
      accountName: hasIdentity || signedIn ? accountNameFrom(first) : null,
      accessExpired,
      needsLogin,
      hasRefreshToken,
    };
  } catch {
    return {
      signedIn: false,
      accountLabel: null,
      accountName: null,
      accessExpired: false,
      needsLogin: true,
      hasRefreshToken: false,
    };
  }
}

/** Explicit unauthenticated markers from Grok Build CLI output. */
const CLI_NOT_AUTHED =
  /you are not authenticated|not authenticated|not logged\s+in|not signed in|please\s+log\s*in|login required|unauthorized|invalid.?token/i;

const CLI_LOGGED_IN = /you are logged in/i;

/**
 * Parse `grok models` stdout/stderr into session + catalog.
 *
 * Important: Grok Build 0.2.x still prints Default model + Available models
 * when logged out ("You are not authenticated."). A non-empty catalog must
 * NOT mean signed-in — that re-signed the Desk UI after every sign-out.
 */
export function parseModelsCliProbe(text: string): {
  signedIn: boolean;
  models: string[];
  defaultModel: string | null;
} {
  const models: string[] = [];
  let defaultModel: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const def = line.match(/Default model:\s*(\S+)/i);
    if (def) defaultModel = def[1]!;
    const m = line.match(/^\s*[\*\-]\s+(\S+)/);
    if (m) models.push(m[1]!);
  }

  if (CLI_NOT_AUTHED.test(text)) {
    return { signedIn: false, models, defaultModel };
  }
  if (CLI_LOGGED_IN.test(text)) {
    return { signedIn: true, models, defaultModel };
  }
  // Catalog-only output (no auth phrase): treat as signed-out for the probe.
  // getGrokAuthStatus still treats auth.json refresh/access tokens as signed-in.
  return { signedIn: false, models, defaultModel };
}

/**
 * Probe `grok models` for login line + model list (no secrets).
 * PATH is limited to the managed binary directory (no global install injection).
 */
export async function probeModelsViaCli(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ signedIn: boolean; models: string[]; defaultModel: string | null }> {
  const enriched = envWithManagedBinary(binary, env);
  try {
    const { stdout, stderr } = await execGrokCli(binary, ["models"], {
      env: enriched,
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return parseModelsCliProbe(`${stdout}\n${stderr}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const out =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout?: unknown }).stdout ?? "")
        : "";
    const errOut =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr ?? "")
        : "";
    const combined = `${msg}\n${out}\n${errOut}`;
    // Prefer parsing any printed catalog + auth markers even on non-zero exit.
    const parsed = parseModelsCliProbe(combined);
    if (CLI_NOT_AUTHED.test(combined) || parsed.models.length > 0) {
      return { ...parsed, signedIn: false };
    }
    // Unknown failure: inconclusive — caller falls back to auth.json.
    return { signedIn: false, models: [], defaultModel: null };
  }
}

export async function getGrokAuthStatus(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): Promise<GrokAuthStatus> {
  // Production auth uses managed binary only — never global PATH discovery.
  const binaryPath = await resolveManagedGrokBinary({ env, platform });
  const fileMeta = await readAuthFileMetadata(home);

  // CLI missing: still respect a saved SuperGrok session so we don't re-prompt login.
  if (!binaryPath) {
    return {
      signedIn: fileMeta.signedIn,
      accountLabel: fileMeta.accountLabel,
      accountName: fileMeta.accountName,
      // Never-signed-in is not reauth. Only stale/prior identity without a session.
      needsReauth: deriveNeedsReauth(fileMeta),
      engineStatus: "missing",
      binaryPath: null,
      models: [],
      defaultModel: null,
    };
  }

  const modelsProbe = await probeModelsViaCli(binaryPath, env);

  // Trust order (never use model catalog alone — see parseModelsCliProbe):
  // 1) auth.json with refresh_token or unexpired access (survives restarts)
  // 2) CLI explicitly "you are logged in"
  // Soft access expiry with a refresh token is normal — CLI refreshes on use.
  const signedIn = fileMeta.signedIn || modelsProbe.signedIn;

  let engineStatus: EngineStatus;
  if (signedIn) {
    engineStatus = "ready";
  } else {
    engineStatus = "needs_auth";
  }

  // Never invent a "session active" label when we only have a public model list.
  const accountLabel = fileMeta.accountLabel;

  return {
    signedIn,
    accountLabel,
    accountName: fileMeta.accountName,
    needsReauth: signedIn ? false : deriveNeedsReauth(fileMeta),
    engineStatus,
    binaryPath,
    models: modelsProbe.models,
    defaultModel: modelsProbe.defaultModel,
  };
}

/**
 * Reauth is only for a previously usable session that became invalid.
 * Fresh installs / explicit "continue without signing in" must stay signed_out
 * (needsReauth=false) so the UI never says "Sign in again".
 */
export function deriveNeedsReauth(
  fileMeta: Pick<
    AuthFileMetadata,
    "signedIn" | "accountLabel" | "accessExpired" | "hasRefreshToken"
  >,
): boolean {
  if (fileMeta.signedIn) return false;
  // Identity residual or expired access without a refresh path = prior session.
  if (fileMeta.accountLabel) return true;
  if (fileMeta.accessExpired && !fileMeta.hasRefreshToken) return true;
  return false;
}

/**
 * True when we must not open a browser for OAuth (unit tests, CI, explicit opt-out).
 * Tests call auth.signIn through the gateway; spawning `grok login --oauth` would
 * open a real browser on every `pnpm test` run.
 */
export function shouldSkipBrowserLogin(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.GROKDESK_SKIP_BROWSER_LOGIN === "1") return true;
  if (env.GROKDESK_SKIP_BROWSER_LOGIN === "0") return false;
  if (env.VITEST === "true") return true;
  if (env.NODE_ENV === "test") return true;
  return false;
}

/**
 * Start interactive SuperGrok login (OAuth). Detached so the UI is not blocked forever.
 * Returns immediately after spawning.
 * Never opens a browser under Vitest / NODE_ENV=test unless GROKDESK_SKIP_BROWSER_LOGIN=0.
 */
export async function startGrokLogin(
  binary: string,
  opts?: { oauth?: boolean; env?: NodeJS.ProcessEnv; force?: boolean },
): Promise<{ pid: number | undefined; skipped?: boolean }> {
  const env = envWithManagedBinary(binary, opts?.env ?? process.env);
  if (!opts?.force && shouldSkipBrowserLogin(opts?.env ?? process.env)) {
    return { pid: undefined, skipped: true };
  }
  const args = ["login"];
  if (opts?.oauth !== false) args.push("--oauth");
  const { command, args: spawnArgs } = cliCommand(binary, args);
  const child = spawn(command, spawnArgs, {
    env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { pid: child.pid, skipped: false };
}

export async function runGrokLogout(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await execGrokCli(binary, ["logout"], {
    env: envWithManagedBinary(binary, env),
    timeout: 30_000,
  });
}

/**
 * Wipe local SuperGrok session file (`~/.grok/auth.json`).
 * Used after CLI logout so Desk never re-reports signed-in from stale tokens.
 * Does not touch other Grok Build config under `~/.grok/`.
 */
export async function clearLocalAuthSession(
  home: string = os.homedir(),
): Promise<{ cleared: boolean; path: string }> {
  const authPath = path.join(home, ".grok", "auth.json");
  try {
    await fs.unlink(authPath);
    return { cleared: true, path: authPath };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { cleared: true, path: authPath };
    // Fallback: empty object if unlink blocked
    try {
      await fs.writeFile(authPath, "{}\n", "utf8");
      return { cleared: true, path: authPath };
    } catch {
      return { cleared: false, path: authPath };
    }
  }
}

export type CompleteSignOutResult = {
  ok: boolean;
  signedOut: boolean;
  cliLogout: "ok" | "skipped" | "failed";
  localCleared: boolean;
  message?: string;
};

/**
 * Full sign-out: CLI logout (when binary present) + clear local auth.json,
 * then verify file no longer reports a session.
 */
export async function completeGrokSignOut(opts?: {
  binary?: string | null;
  env?: NodeJS.ProcessEnv;
  home?: string;
}): Promise<CompleteSignOutResult> {
  const env = opts?.env ?? process.env;
  const home = opts?.home ?? os.homedir();
  let cliLogout: CompleteSignOutResult["cliLogout"] = "skipped";
  const binary = opts?.binary;

  if (binary) {
    try {
      await runGrokLogout(binary, env);
      cliLogout = "ok";
    } catch (e) {
      cliLogout = "failed";
      // Still clear local session — user asked to sign out of Desk.
      void e;
    }
  }

  const local = await clearLocalAuthSession(home);
  const meta = await readAuthFileMetadata(home);
  const signedOut = !meta.signedIn;

  return {
    ok: signedOut && local.cleared,
    signedOut,
    cliLogout,
    localCleared: local.cleared,
    message: signedOut
      ? undefined
      : "Signed out of Desk, but a SuperGrok session may still remain. Try again or run `grok logout` in a terminal.",
  };
}
