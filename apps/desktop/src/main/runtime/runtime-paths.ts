/**
 * Path layout for Desk-managed Grok runtimes under Electron userData.
 *
 * All resolved paths are validated to remain below the runtime root.
 * Version strings with path separators or `..` are rejected.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  type Stats,
} from "node:fs";
import path from "node:path";
import {
  isCanonicalRuntimeTarget,
  isPathInsideRoot,
  type CanonicalRuntimeTarget,
} from "@grokdesk/shared";

export const RUNTIMES_DIRNAME = "runtimes";
export const GROK_RUNTIME_DIRNAME = "grok";
export const CURRENT_POINTER_FILENAME = "current.json";
export const CURRENT_POINTER_BACKUP_FILENAME = "current.json.bak";
export const INSTALLATION_FILENAME = "installation.json";
export const INSTALL_JOURNAL_FILENAME = "install-journal.json";
export const STAGING_DIRNAME = "staging";
export const QUARANTINE_DIRNAME = "quarantine";

/** SemVer-friendly version segment: no path separators, dots only as version dots. */
const SAFE_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

export class RuntimePathError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "RuntimePathError";
    this.code = code;
  }
}

/**
 * Reject path-traversal and unsafe version directory names.
 * Throws with code `invalid_runtime_version`.
 */
export function assertSafeRuntimeVersion(version: string): string {
  if (typeof version !== "string" || version.length === 0) {
    throw new RuntimePathError(
      "invalid_runtime_version",
      "invalid_runtime_version",
    );
  }
  if (
    version === "." ||
    version === ".." ||
    version.includes("/") ||
    version.includes("\\") ||
    version.includes("\0") ||
    version.includes("..") ||
    !SAFE_VERSION_RE.test(version)
  ) {
    throw new RuntimePathError(
      "invalid_runtime_version",
      "invalid_runtime_version",
    );
  }
  return version;
}

export function assertCanonicalTarget(
  target: string,
): CanonicalRuntimeTarget {
  if (!isCanonicalRuntimeTarget(target)) {
    throw new RuntimePathError(
      "invalid_runtime_target",
      `invalid_runtime_target:${target}`,
    );
  }
  return target;
}

/** Binary file name for a target (`grok.exe` on Windows, `grok` elsewhere). */
export function runtimeBinaryName(target: CanonicalRuntimeTarget | string): string {
  const t = String(target);
  if (t.startsWith("win32")) return "grok.exe";
  return "grok";
}

/** `<userData>/runtimes/grok` */
export function grokRuntimeRoot(userData: string): string {
  if (!userData || typeof userData !== "string") {
    throw new RuntimePathError("invalid_user_data", "userData path required");
  }
  return path.resolve(userData, RUNTIMES_DIRNAME, GROK_RUNTIME_DIRNAME);
}

/** `<userData>/runtimes/grok/current.json` */
export function currentPointerPath(userData: string): string {
  return path.join(grokRuntimeRoot(userData), CURRENT_POINTER_FILENAME);
}

/** `<userData>/runtimes/grok/current.json.bak` */
export function currentPointerBackupPath(userData: string): string {
  return path.join(grokRuntimeRoot(userData), CURRENT_POINTER_BACKUP_FILENAME);
}

/** `<userData>/runtimes/grok/install-journal.json` — durable install transaction state. */
export function installJournalPath(userData: string): string {
  return path.join(grokRuntimeRoot(userData), INSTALL_JOURNAL_FILENAME);
}

/** `<userData>/runtimes/grok/staging` */
export function stagingDir(userData: string): string {
  return path.join(grokRuntimeRoot(userData), STAGING_DIRNAME);
}

/** `<userData>/runtimes/grok/quarantine` */
export function quarantineDir(userData: string): string {
  return path.join(grokRuntimeRoot(userData), QUARANTINE_DIRNAME);
}

/**
 * `<userData>/runtimes/grok/<version>/<target>`
 * Rejects path-traversal versions and unknown targets.
 */
export function runtimeVersionDir(
  userData: string,
  version: string,
  target: string,
): string {
  const v = assertSafeRuntimeVersion(version);
  const t = assertCanonicalTarget(target);
  const root = grokRuntimeRoot(userData);
  const resolved = path.resolve(root, v, t);
  assertPathUnderRoot(resolved, root);
  return resolved;
}

/**
 * Full path to the managed binary:
 * `<userData>/runtimes/grok/<version>/<target>/grok[.exe]`
 */
export function runtimeBinary(
  userData: string,
  version: string,
  target: string,
): string {
  const dir = runtimeVersionDir(userData, version, target);
  const t = assertCanonicalTarget(target);
  const file = path.join(dir, runtimeBinaryName(t));
  assertPathUnderRoot(file, grokRuntimeRoot(userData));
  return file;
}

/** `.../<version>/<target>/installation.json` */
export function installationJsonPath(
  userData: string,
  version: string,
  target: string,
): string {
  const dir = runtimeVersionDir(userData, version, target);
  const file = path.join(dir, INSTALLATION_FILENAME);
  assertPathUnderRoot(file, grokRuntimeRoot(userData));
  return file;
}

/**
 * Ensure `resolved` is strictly under `root` (or equal) after path.normalize.
 * Does not follow symlinks — pair with {@link assertNoSymlinkEscape}.
 */
export function assertPathUnderRoot(resolved: string, root: string): string {
  const absTarget = path.resolve(resolved);
  const absRoot = path.resolve(root);
  if (absTarget === absRoot) return absTarget;
  const prefix = absRoot.endsWith(path.sep) ? absRoot : absRoot + path.sep;
  if (!absTarget.startsWith(prefix)) {
    throw new RuntimePathError(
      "path_escape",
      `path escapes runtime root: ${absTarget}`,
    );
  }
  return absTarget;
}

/**
 * Walk every path component from root to target with lstat; reject if any
 * component is a symlink whose real path leaves the runtime root.
 */
export function assertNoSymlinkEscape(
  targetPath: string,
  root: string,
): string {
  const absTarget = path.resolve(targetPath);
  const absRoot = path.resolve(root);
  assertPathUnderRoot(absTarget, absRoot);

  // Ensure root itself is not a symlink out of its parent (best-effort).
  if (existsSync(absRoot)) {
    try {
      const rootReal = realpathSync(absRoot);
      // root may itself live under userData; we only constrain relative to root.
      void rootReal;
    } catch {
      /* unreadable — continue component walk */
    }
  }

  const rel = path.relative(absRoot, absTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new RuntimePathError("path_escape", "path escapes runtime root");
  }

  let cursor = absRoot;
  if (rel.length === 0) return absTarget;

  const parts = rel.split(path.sep).filter((p) => p.length > 0);
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let st: Stats;
    try {
      st = lstatSync(cursor);
    } catch {
      // Missing intermediate is fine for planned writes.
      continue;
    }
    if (st.isSymbolicLink()) {
      let real: string;
      try {
        real = realpathSync(cursor);
      } catch {
        throw new RuntimePathError(
          "symlink_escape",
          `unresolvable symlink at ${cursor}`,
        );
      }
      try {
        assertPathUnderRoot(real, absRoot);
      } catch {
        throw new RuntimePathError(
          "symlink_escape",
          `symlink escapes runtime root: ${cursor}`,
        );
      }
      // Continue walk from the real path so nested escapes are caught.
      cursor = real;
    }
  }
  return absTarget;
}

/** Create a directory tree with user-only permissions (0700). */
export function mkdirUserOnly(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    // recursive mkdir may not apply mode to existing parents on all platforms.
    chmodSync(dir, 0o700);
  } catch {
    /* Windows / unsupported */
  }
}

/**
 * Ensure the managed runtime layout exists:
 * root, staging/, quarantine/ with user-only perms.
 */
export function ensureRuntimeLayout(userData: string): {
  root: string;
  staging: string;
  quarantine: string;
  currentPointer: string;
} {
  const root = grokRuntimeRoot(userData);
  const staging = stagingDir(userData);
  const quarantine = quarantineDir(userData);
  mkdirUserOnly(root);
  mkdirUserOnly(staging);
  mkdirUserOnly(quarantine);
  return {
    root,
    staging,
    quarantine,
    currentPointer: currentPointerPath(userData),
  };
}

/** True when a path is under staging/ or quarantine/ (never selectable). */
export function isStagingOrQuarantinePath(
  userData: string,
  candidate: string,
): boolean {
  const abs = path.resolve(candidate);
  const staging = path.resolve(stagingDir(userData));
  const quarantine = path.resolve(quarantineDir(userData));
  return isPathInsideRoot(abs, staging) || isPathInsideRoot(abs, quarantine);
}
