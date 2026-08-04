/**
 * Side-by-side Grok runtime store: installation records and atomic current.json.
 *
 * Pointer switches use unique temp → fsync → backup → rename → cleanup, then
 * re-read/rehash. Staging and quarantine paths are never selectable.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";
import type { CanonicalRuntimeTarget } from "@grokdesk/shared";
import {
  assertNoSymlinkEscape,
  assertPathUnderRoot,
  assertSafeRuntimeVersion,
  currentPointerBackupPath,
  currentPointerPath,
  ensureRuntimeLayout,
  grokRuntimeRoot,
  installationJsonPath,
  isStagingOrQuarantinePath,
  mkdirUserOnly,
  runtimeBinary,
  runtimeVersionDir,
} from "./runtime-paths.js";
import {
  AtomicWriteCrashError,
  RUNTIME_INSTALLATION_SCHEMA_VERSION,
  RUNTIME_POINTER_SCHEMA_VERSION,
  type AtomicPointerCrashPoint,
  type RuntimeCurrentPointer,
  type RuntimeInstallationRecord,
  type RuntimeInstallationRef,
} from "./runtime-types.js";

export type AtomicPointerWriteOptions = {
  /** Test-only: throw {@link AtomicWriteCrashError} at the given stage. */
  crashAt?: AtomicPointerCrashPoint;
  /** Override clock for `updatedAt`. */
  now?: () => Date;
};

export type LoadPointerResult =
  | { ok: true; pointer: RuntimeCurrentPointer }
  | {
      ok: false;
      code: "absent" | "corrupt" | "incomplete_install" | "staging_ref";
      message: string;
    };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isSha256Hex(v: unknown): v is string {
  return typeof v === "string" && /^[a-fA-F0-9]{64}$/.test(v);
}

function parseInstallationRef(raw: unknown): RuntimeInstallationRef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(o.version) ||
    !isNonEmptyString(o.target) ||
    !isSha256Hex(o.digestSha256)
  ) {
    return null;
  }
  try {
    assertSafeRuntimeVersion(o.version);
  } catch {
    return null;
  }
  return {
    version: o.version,
    target: o.target as CanonicalRuntimeTarget,
    digestSha256: o.digestSha256.toLowerCase(),
  };
}

export function parseRuntimeCurrentPointer(
  raw: unknown,
): RuntimeCurrentPointer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== RUNTIME_POINTER_SCHEMA_VERSION) return null;
  if (!isNonEmptyString(o.updatedAt)) return null;
  const current = parseInstallationRef(o.current);
  if (!current) return null;
  let previous: RuntimeInstallationRef | null = null;
  if (o.previous !== null && o.previous !== undefined) {
    previous = parseInstallationRef(o.previous);
    if (!previous) return null;
  }
  return {
    schemaVersion: RUNTIME_POINTER_SCHEMA_VERSION,
    current,
    previous,
    updatedAt: o.updatedAt,
  };
}

export function parseRuntimeInstallationRecord(
  raw: unknown,
): RuntimeInstallationRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== RUNTIME_INSTALLATION_SCHEMA_VERSION) return null;
  if (
    !isNonEmptyString(o.artifactId) ||
    !isNonEmptyString(o.version) ||
    !isNonEmptyString(o.target) ||
    !isSha256Hex(o.digestSha256) ||
    typeof o.sizeBytes !== "number" ||
    !Number.isFinite(o.sizeBytes) ||
    o.sizeBytes < 0 ||
    typeof o.manifestSequence !== "number" ||
    !Number.isInteger(o.manifestSequence) ||
    o.manifestSequence < 0 ||
    !isNonEmptyString(o.manifestKeyId) ||
    !isNonEmptyString(o.installedAt) ||
    typeof o.complete !== "boolean"
  ) {
    return null;
  }
  try {
    assertSafeRuntimeVersion(o.version);
  } catch {
    return null;
  }
  if (!o.provenance || typeof o.provenance !== "object") return null;
  const prov = o.provenance as Record<string, unknown>;
  if (!isNonEmptyString(prov.source) || !isNonEmptyString(prov.retrievedAt)) {
    return null;
  }
  if (!o.platformSigning || typeof o.platformSigning !== "object") return null;
  const ps = o.platformSigning as Record<string, unknown>;
  if (typeof ps.checked !== "boolean" || typeof ps.valid !== "boolean") {
    return null;
  }
  if (!Array.isArray(o.probes)) return null;

  return {
    schemaVersion: RUNTIME_INSTALLATION_SCHEMA_VERSION,
    artifactId: o.artifactId,
    version: o.version,
    target: o.target as CanonicalRuntimeTarget,
    digestSha256: o.digestSha256.toLowerCase(),
    sizeBytes: o.sizeBytes,
    provenance: {
      source: prov.source,
      retrievedAt: prov.retrievedAt,
      ...(isNonEmptyString(prov.officialUrl)
        ? { officialUrl: prov.officialUrl }
        : {}),
    },
    manifestSequence: o.manifestSequence,
    manifestKeyId: o.manifestKeyId,
    installedAt: o.installedAt,
    platformSigning: {
      checked: ps.checked,
      valid: ps.valid,
      ...(isNonEmptyString(ps.teamId) ? { teamId: ps.teamId } : {}),
      ...(isNonEmptyString(ps.status) ? { status: ps.status } : {}),
      ...(isNonEmptyString(ps.subject) ? { subject: ps.subject } : {}),
      ...(isNonEmptyString(ps.thumbprint) ? { thumbprint: ps.thumbprint } : {}),
      ...(isNonEmptyString(ps.detail) ? { detail: ps.detail } : {}),
    },
    probes: o.probes as RuntimeInstallationRecord["probes"],
    complete: o.complete,
    ...(Array.isArray(o.capabilities)
      ? { capabilities: o.capabilities.filter(isNonEmptyString) }
      : {}),
  };
}

/** SHA-256 hex of file contents (streaming would be better for large bins). */
export function sha256File(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

function maybeCrash(
  crashAt: AtomicPointerCrashPoint | undefined,
  point: AtomicPointerCrashPoint,
): void {
  if (crashAt === point) {
    throw new AtomicWriteCrashError(point);
  }
}

/**
 * Atomic JSON write with optional backup of the previous file.
 * Crash injection supports recovery tests at each durability boundary.
 */
export function atomicWriteJsonFile(
  filePath: string,
  contents: string,
  options: {
    crashAt?: AtomicPointerCrashPoint;
    mode?: number;
    backupPath?: string;
  } = {},
): void {
  const mode = options.mode ?? 0o600;
  const dir = path.dirname(filePath);
  mkdirUserOnly(dir);

  maybeCrash(options.crashAt, "before_temp_write");

  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${randomBytes(8).toString("hex")}.tmp`,
  );

  const fd = openSync(tmp, "w", mode);
  try {
    writeFileSync(fd, contents);
    maybeCrash(options.crashAt, "after_temp_write");
    fsyncSync(fd);
    maybeCrash(options.crashAt, "after_fsync");
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(tmp, mode);
  } catch {
    /* Windows */
  }

  maybeCrash(options.crashAt, "before_rename");

  // Preserve previous durable pointer for recovery if rename is interrupted.
  if (options.backupPath && existsSync(filePath)) {
    try {
      // Replace any stale backup first.
      if (existsSync(options.backupPath)) {
        try {
          unlinkSync(options.backupPath);
        } catch {
          /* ignore */
        }
      }
      renameSync(filePath, options.backupPath);
    } catch {
      // Fall through — still attempt primary rename.
    }
  }

  try {
    renameSync(tmp, filePath);
  } catch {
    // Windows cannot rename over an existing file.
    try {
      unlinkSync(filePath);
    } catch {
      /* absent */
    }
    renameSync(tmp, filePath);
  }

  maybeCrash(options.crashAt, "after_rename");

  if (options.backupPath && existsSync(options.backupPath)) {
    try {
      unlinkSync(options.backupPath);
    } catch {
      /* best-effort */
    }
  }

  maybeCrash(options.crashAt, "after_backup_cleanup");
}

export type RuntimeStoreOptions = {
  /** Electron `app.getPath("userData")` (or test temp dir). */
  userData: string;
  now?: () => Date;
};

export class RuntimeStore {
  readonly userData: string;
  private readonly now: () => Date;

  constructor(options: RuntimeStoreOptions) {
    this.userData = options.userData;
    this.now = options.now ?? (() => new Date());
  }

  get root(): string {
    return grokRuntimeRoot(this.userData);
  }

  ensureLayout(): void {
    ensureRuntimeLayout(this.userData);
  }

  pointerPath(): string {
    return currentPointerPath(this.userData);
  }

  backupPointerPath(): string {
    return currentPointerBackupPath(this.userData);
  }

  binaryPath(version: string, target: string): string {
    return runtimeBinary(this.userData, version, target);
  }

  installationPath(version: string, target: string): string {
    return installationJsonPath(this.userData, version, target);
  }

  versionDir(version: string, target: string): string {
    return runtimeVersionDir(this.userData, version, target);
  }

  /**
   * Persist installation metadata next to the binary (user-only perms).
   * Caller is responsible for placing the binary first.
   */
  writeInstallation(record: RuntimeInstallationRecord): void {
    const parsed = parseRuntimeInstallationRecord(record);
    if (!parsed) {
      throw new Error("invalid_installation_record");
    }
    const file = this.installationPath(parsed.version, parsed.target);
    const dir = path.dirname(file);
    mkdirUserOnly(dir);
    assertNoSymlinkEscape(dir, this.root);
    assertPathUnderRoot(file, this.root);
    if (isStagingOrQuarantinePath(this.userData, file)) {
      throw new Error("staging_or_quarantine_not_installable");
    }
    atomicWriteJsonFile(file, `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
  }

  loadInstallation(
    version: string,
    target: string,
  ): RuntimeInstallationRecord | null {
    const file = this.installationPath(version, target);
    if (!existsSync(file)) return null;
    try {
      assertNoSymlinkEscape(file, this.root);
    } catch {
      return null;
    }
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return null;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    return parseRuntimeInstallationRecord(raw);
  }

  /**
   * True when installation.json exists, complete=true, binary exists under
   * the version dir (not staging/quarantine), and digest matches on disk.
   */
  isCompleteVerifiedInstall(
    ref: RuntimeInstallationRef,
  ): { ok: true; binaryPath: string; record: RuntimeInstallationRecord } | {
    ok: false;
    reason: string;
  } {
    const binary = this.binaryPath(ref.version, ref.target);
    if (isStagingOrQuarantinePath(this.userData, binary)) {
      return { ok: false, reason: "staging_or_quarantine" };
    }
    try {
      assertNoSymlinkEscape(binary, this.root);
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "symlink_escape",
      };
    }
    if (!existsSync(binary)) {
      return { ok: false, reason: "binary_missing" };
    }
    const record = this.loadInstallation(ref.version, ref.target);
    if (!record) {
      return { ok: false, reason: "installation_missing" };
    }
    if (!record.complete) {
      return { ok: false, reason: "installation_incomplete" };
    }
    if (record.version !== ref.version || record.target !== ref.target) {
      return { ok: false, reason: "ref_mismatch" };
    }
    if (record.digestSha256.toLowerCase() !== ref.digestSha256.toLowerCase()) {
      return { ok: false, reason: "digest_ref_mismatch" };
    }
    let onDisk: string;
    try {
      onDisk = sha256File(binary);
    } catch {
      return { ok: false, reason: "binary_unreadable" };
    }
    if (onDisk !== record.digestSha256.toLowerCase()) {
      return { ok: false, reason: "digest_mismatch" };
    }
    return { ok: true, binaryPath: binary, record };
  }

  loadPointer(): LoadPointerResult {
    const file = this.pointerPath();
    if (!existsSync(file)) {
      return { ok: false, code: "absent", message: "current.json absent" };
    }
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (err) {
      return {
        ok: false,
        code: "corrupt",
        message: `current.json unreadable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, code: "corrupt", message: "current.json is not JSON" };
    }
    const pointer = parseRuntimeCurrentPointer(raw);
    if (!pointer) {
      return {
        ok: false,
        code: "corrupt",
        message: "current.json shape invalid",
      };
    }

    // Never honor a pointer whose binary path would resolve into staging/quarantine.
    const currentBin = this.binaryPath(
      pointer.current.version,
      pointer.current.target,
    );
    if (isStagingOrQuarantinePath(this.userData, currentBin)) {
      return {
        ok: false,
        code: "staging_ref",
        message: "current pointer resolves to staging/quarantine",
      };
    }

    return { ok: true, pointer };
  }

  /**
   * Load backup pointer written mid-switch (if present and valid).
   */
  loadBackupPointer(): LoadPointerResult {
    const file = this.backupPointerPath();
    if (!existsSync(file)) {
      return { ok: false, code: "absent", message: "current.json.bak absent" };
    }
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (err) {
      return {
        ok: false,
        code: "corrupt",
        message: `backup unreadable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, code: "corrupt", message: "backup is not JSON" };
    }
    const pointer = parseRuntimeCurrentPointer(raw);
    if (!pointer) {
      return { ok: false, code: "corrupt", message: "backup shape invalid" };
    }
    return { ok: true, pointer };
  }

  /**
   * Atomically switch current/previous refs. Re-reads and rehashes after rename.
   */
  switchPointer(
    next: {
      current: RuntimeInstallationRef;
      previous?: RuntimeInstallationRef | null;
    },
    options: AtomicPointerWriteOptions = {},
  ): RuntimeCurrentPointer {
    this.ensureLayout();

    // Refuse to select incomplete/staging installs.
    const verified = this.isCompleteVerifiedInstall(next.current);
    if (!verified.ok) {
      throw new Error(`incomplete_install:${verified.reason}`);
    }
    if (next.previous) {
      const prevOk = this.isCompleteVerifiedInstall(next.previous);
      if (!prevOk.ok) {
        throw new Error(`incomplete_previous:${prevOk.reason}`);
      }
    }

    const pointer: RuntimeCurrentPointer = {
      schemaVersion: RUNTIME_POINTER_SCHEMA_VERSION,
      current: {
        version: next.current.version,
        target: next.current.target,
        digestSha256: next.current.digestSha256.toLowerCase(),
      },
      previous: next.previous
        ? {
            version: next.previous.version,
            target: next.previous.target,
            digestSha256: next.previous.digestSha256.toLowerCase(),
          }
        : null,
      updatedAt: (options.now ?? this.now)().toISOString(),
    };

    const file = this.pointerPath();
    atomicWriteJsonFile(file, `${JSON.stringify(pointer)}\n`, {
      crashAt: options.crashAt,
      mode: 0o600,
      backupPath: this.backupPointerPath(),
    });

    // Re-read and rehash selection (plan: never trust write alone).
    const loaded = this.loadPointer();
    if (!loaded.ok) {
      throw new Error(`pointer_reread_failed:${loaded.code}`);
    }
    if (
      loaded.pointer.current.version !== pointer.current.version ||
      loaded.pointer.current.digestSha256 !== pointer.current.digestSha256
    ) {
      throw new Error("pointer_reread_mismatch");
    }
    const recheck = this.isCompleteVerifiedInstall(loaded.pointer.current);
    if (!recheck.ok) {
      throw new Error(`pointer_rehash_failed:${recheck.reason}`);
    }

    return loaded.pointer;
  }

  /**
   * List version directory names under the runtime root (excludes staging/quarantine/files).
   */
  listInstalledVersions(): string[] {
    const root = this.root;
    if (!existsSync(root)) return [];
    const names = readdirSync(root, { withFileTypes: true });
    const versions: string[] = [];
    for (const ent of names) {
      if (!ent.isDirectory()) continue;
      if (
        ent.name === "staging" ||
        ent.name === "quarantine" ||
        ent.name.startsWith(".")
      ) {
        continue;
      }
      try {
        assertSafeRuntimeVersion(ent.name);
        versions.push(ent.name);
      } catch {
        /* skip non-version dirs */
      }
    }
    return versions.sort();
  }

  /**
   * Remove a version directory entirely. Refuses current/previous unless forced.
   */
  removeVersion(version: string, options: { force?: boolean } = {}): void {
    assertSafeRuntimeVersion(version);
    if (!options.force) {
      const ptr = this.loadPointer();
      if (ptr.ok) {
        if (ptr.pointer.current.version === version) {
          throw new Error("cannot_remove_current");
        }
        if (ptr.pointer.previous?.version === version) {
          throw new Error("cannot_remove_previous");
        }
      }
    }
    const dir = path.join(this.root, version);
    assertPathUnderRoot(dir, this.root);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Best-effort remove abandoned temp pointer files. */
  cleanupPointerTemps(): string[] {
    const root = this.root;
    if (!existsSync(root)) return [];
    const removed: string[] = [];
    for (const name of readdirSync(root)) {
      if (
        name.startsWith(".current.json.") &&
        name.endsWith(".tmp")
      ) {
        const full = path.join(root, name);
        try {
          unlinkSync(full);
          removed.push(full);
        } catch {
          /* locked */
        }
      }
    }
    return removed;
  }
}

/** Test helper: write a minimal complete install tree (binary + installation.json). */
export function seedCompleteInstall(
  store: RuntimeStore,
  args: {
    version: string;
    target: CanonicalRuntimeTarget;
    content?: string | Buffer;
    digestSha256?: string;
    complete?: boolean;
    artifactId?: string;
  },
): RuntimeInstallationRef {
  store.ensureLayout();
  const content = args.content ?? `grok-binary-${args.version}\n`;
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const digest =
    args.digestSha256 ?? createHash("sha256").update(buf).digest("hex");
  const dir = store.versionDir(args.version, args.target);
  mkdirUserOnly(dir);
  const binary = store.binaryPath(args.version, args.target);
  writeFileSync(binary, buf, { mode: 0o700 });
  try {
    chmodSync(binary, 0o700);
  } catch {
    /* Windows */
  }
  const record: RuntimeInstallationRecord = {
    schemaVersion: RUNTIME_INSTALLATION_SCHEMA_VERSION,
    artifactId: args.artifactId ?? `art-${args.version}`,
    version: args.version,
    target: args.target,
    digestSha256: digest,
    sizeBytes: buf.length,
    provenance: {
      source: "test",
      retrievedAt: "2026-07-16T00:00:00.000Z",
    },
    manifestSequence: 1,
    manifestKeyId: "release-1",
    installedAt: "2026-07-16T00:00:00.000Z",
    platformSigning: { checked: true, valid: true },
    probes: [{ name: "version", ok: true, summary: args.version }],
    complete: args.complete ?? true,
  };
  store.writeInstallation(record);
  // Touch size check.
  void statSync(binary);
  return {
    version: args.version,
    target: args.target,
    digestSha256: digest,
  };
}
