/**
 * Atomic on-disk store for signed entitlement lease state.
 *
 * Persists only the public lease token plus safe denial metadata.
 * Never stores product keys (GD3), device private keys, or vault secrets.
 *
 * Write path (crash-safe): unique temp → fsync → rename → fsync directory.
 * Failures before rename leave any previous valid file intact.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** On-disk filename under the entitlements directory. */
export const ENTITLEMENT_STATE_FILENAME = "state.json" as const;

/** Hard cap on state file size (lease tokens are themselves bounded). */
export const MAX_ENTITLEMENT_STATE_BYTES = 64 * 1024;

/** POSIX file mode: owner read/write only. */
export const STATE_FILE_MODE = 0o600;

/** POSIX directory mode: owner rwx only. */
export const STATE_DIR_MODE = 0o700;

export type AuthoritativeState =
  | "none"
  | "suspended"
  | "refunded"
  | "revoked"
  | "device_deactivated";

export const AUTHORITATIVE_STATES = [
  "none",
  "suspended",
  "refunded",
  "revoked",
  "device_deactivated",
] as const satisfies readonly AuthoritativeState[];

/**
 * Durable entitlement state envelope written by Electron main and read by
 * the gateway via `GROKDESK_ENTITLEMENT_STATE_PATH`.
 */
export type EntitlementStateFile = {
  schema: 1;
  deviceId: string;
  devicePublicKeyThumbprint: string;
  lease: string | null;
  authoritativeState: AuthoritativeState;
  updatedAt: string;
  requestId: string | null;
};

export type EntitlementStateErrorCode =
  | "invalid_schema"
  | "oversized"
  | "symlink"
  | "insecure_permissions"
  | "corrupt"
  | "io"
  | "contains_secrets";

export class EntitlementStateError extends Error {
  readonly code: EntitlementStateErrorCode;

  constructor(code: EntitlementStateErrorCode, message?: string) {
    super(message ?? code);
    this.name = "EntitlementStateError";
    this.code = code;
  }
}

export function isEntitlementStateError(
  err: unknown,
): err is EntitlementStateError {
  return (
    err instanceof EntitlementStateError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: string }).name === "EntitlementStateError")
  );
}

/** Crash-injection hooks for durability tests. */
export type EntitlementStateStoreHooks = {
  /** Invoked after validation, before creating/writing the temp file. */
  beforeWrite?: () => void | Promise<void>;
  /** Invoked after temp file fsync, before close/rename. */
  afterFsync?: () => void | Promise<void>;
  /** Invoked after temp close, immediately before rename. */
  beforeRename?: () => void | Promise<void>;
};

export type EntitlementStateStoreOptions = {
  maxBytes?: number;
  hooks?: EntitlementStateStoreHooks;
};

const ALLOWED_KEYS = new Set([
  "schema",
  "deviceId",
  "devicePublicKeyThumbprint",
  "lease",
  "authoritativeState",
  "updatedAt",
  "requestId",
]);

const GD3_PRODUCT_KEY_RE = /\bGD3\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const PRIVATE_KEY_FIELD_RE =
  /privatePkcs8|private_key|privateKey|-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/i;

function isAuthoritativeState(value: unknown): value is AuthoritativeState {
  return (
    typeof value === "string" &&
    (AUTHORITATIVE_STATES as readonly string[]).includes(value)
  );
}

function isPosix(): boolean {
  return process.platform !== "win32";
}

/**
 * Default path: `<userData>/entitlements/state.json`.
 */
export function defaultEntitlementStatePath(userDataDir: string): string {
  return path.join(userDataDir, "entitlements", ENTITLEMENT_STATE_FILENAME);
}

/**
 * Validate and normalize a parsed JSON value into EntitlementStateFile.
 * Rejects unknown schema, oversized input, secret-bearing content, and
 * malformed fields.
 */
export function parseEntitlementStateFile(
  raw: string,
  maxBytes: number = MAX_ENTITLEMENT_STATE_BYTES,
): EntitlementStateFile {
  if (typeof raw !== "string") {
    throw new EntitlementStateError("corrupt", "state must be a string");
  }
  const byteLength = Buffer.byteLength(raw, "utf8");
  if (byteLength > maxBytes) {
    throw new EntitlementStateError("oversized", "entitlement state file oversized");
  }
  if (byteLength === 0) {
    throw new EntitlementStateError("corrupt", "empty entitlement state");
  }

  // Canary: never accept product keys or private key material on disk.
  if (GD3_PRODUCT_KEY_RE.test(raw) || PRIVATE_KEY_FIELD_RE.test(raw)) {
    throw new EntitlementStateError(
      "contains_secrets",
      "entitlement state must not contain product keys or private keys",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new EntitlementStateError("corrupt", "invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new EntitlementStateError("corrupt", "state must be an object");
  }

  const rec = parsed as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new EntitlementStateError(
        "corrupt",
        `unknown entitlement state field: ${key}`,
      );
    }
  }

  if (rec.schema !== 1) {
    throw new EntitlementStateError(
      "invalid_schema",
      `unsupported entitlement state schema: ${String(rec.schema)}`,
    );
  }
  if (typeof rec.deviceId !== "string" || rec.deviceId.length === 0) {
    throw new EntitlementStateError("corrupt", "deviceId required");
  }
  if (
    typeof rec.devicePublicKeyThumbprint !== "string" ||
    rec.devicePublicKeyThumbprint.length === 0
  ) {
    throw new EntitlementStateError(
      "corrupt",
      "devicePublicKeyThumbprint required",
    );
  }
  if (!(rec.lease === null || typeof rec.lease === "string")) {
    throw new EntitlementStateError("corrupt", "lease must be string or null");
  }
  if (typeof rec.lease === "string") {
    if (rec.lease.startsWith("GD3.") || GD3_PRODUCT_KEY_RE.test(rec.lease)) {
      throw new EntitlementStateError(
        "contains_secrets",
        "lease must not be a product key",
      );
    }
    if (PRIVATE_KEY_FIELD_RE.test(rec.lease)) {
      throw new EntitlementStateError(
        "contains_secrets",
        "lease must not contain private key material",
      );
    }
  }
  if (!isAuthoritativeState(rec.authoritativeState)) {
    throw new EntitlementStateError("corrupt", "invalid authoritativeState");
  }
  if (typeof rec.updatedAt !== "string" || rec.updatedAt.length === 0) {
    throw new EntitlementStateError("corrupt", "updatedAt required");
  }
  if (!(rec.requestId === null || typeof rec.requestId === "string")) {
    throw new EntitlementStateError(
      "corrupt",
      "requestId must be string or null",
    );
  }

  return {
    schema: 1,
    deviceId: rec.deviceId,
    devicePublicKeyThumbprint: rec.devicePublicKeyThumbprint,
    lease: rec.lease,
    authoritativeState: rec.authoritativeState,
    updatedAt: rec.updatedAt,
    requestId: rec.requestId,
  };
}

/**
 * Serialize state to canonical JSON. Rejects secret-bearing values.
 */
export function serializeEntitlementStateFile(
  state: EntitlementStateFile,
  maxBytes: number = MAX_ENTITLEMENT_STATE_BYTES,
): string {
  // Re-parse through the validator so write path shares read invariants.
  const normalized: EntitlementStateFile = {
    schema: 1,
    deviceId: state.deviceId,
    devicePublicKeyThumbprint: state.devicePublicKeyThumbprint,
    lease: state.lease,
    authoritativeState: state.authoritativeState,
    updatedAt: state.updatedAt,
    requestId: state.requestId,
  };
  const body = `${JSON.stringify(normalized)}\n`;
  // Validate via parser (schema, secrets, size).
  parseEntitlementStateFile(body, maxBytes);
  if (Buffer.byteLength(body, "utf8") > maxBytes) {
    throw new EntitlementStateError("oversized", "entitlement state file oversized");
  }
  return body;
}

function assertNotSymlink(stat: fs.Stats, label: string): void {
  if (stat.isSymbolicLink()) {
    throw new EntitlementStateError("symlink", `${label} must not be a symlink`);
  }
}

function assertSecureFileMode(mode: number, label: string): void {
  if (!isPosix()) return;
  // Reject group/other bits (world or group readable/writable/executable).
  if ((mode & 0o077) !== 0) {
    throw new EntitlementStateError(
      "insecure_permissions",
      `${label} must not be group/world accessible (mode=${(mode & 0o777).toString(8)})`,
    );
  }
}

function assertSecureDirMode(mode: number, label: string): void {
  if (!isPosix()) return;
  if ((mode & 0o077) !== 0) {
    throw new EntitlementStateError(
      "insecure_permissions",
      `${label} must be user-only (mode=${(mode & 0o777).toString(8)})`,
    );
  }
}

async function fsyncDirectory(dirPath: string): Promise<void> {
  // Directory fsync is best-effort: supported on POSIX; may fail on Windows.
  try {
    const dirFd = await fsp.open(dirPath, "r");
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  } catch (err) {
    if (process.platform === "win32") return;
    // Some filesystems reject directory open/sync; surface as io only if unexpected.
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "EISDIR" || code === "EPERM" || code === "EINVAL") {
      // Retry via fs.openSync path used by some Node versions.
      try {
        const fd = fs.openSync(dirPath, "r");
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        return;
      } catch {
        return;
      }
    }
    throw new EntitlementStateError(
      "io",
      `directory fsync failed: ${code ?? "unknown"}`,
    );
  }
}

/**
 * Atomic entitlement state file store.
 */
export class EntitlementStateStore {
  readonly filePath: string;
  private readonly maxBytes: number;
  private readonly hooks: EntitlementStateStoreHooks;

  constructor(filePath: string, options: EntitlementStateStoreOptions = {}) {
    if (!filePath || typeof filePath !== "string") {
      throw new EntitlementStateError("io", "filePath required");
    }
    this.filePath = path.resolve(filePath);
    this.maxBytes = options.maxBytes ?? MAX_ENTITLEMENT_STATE_BYTES;
    this.hooks = options.hooks ?? {};
  }

  /** Absolute path of the durable state file. */
  get path(): string {
    return this.filePath;
  }

  /** Parent directory of the state file. */
  get dirPath(): string {
    return path.dirname(this.filePath);
  }

  /**
   * Ensure parent directory exists with user-only permissions (POSIX 0700).
   */
  async ensureParentDir(): Promise<void> {
    const dir = this.dirPath;
    await fsp.mkdir(dir, { recursive: true, mode: STATE_DIR_MODE });
    if (isPosix()) {
      // mkdir recursive may preserve looser modes on existing ancestors;
      // tighten the leaf entitlements directory.
      await fsp.chmod(dir, STATE_DIR_MODE);
      const st = await fsp.lstat(dir);
      assertNotSymlink(st, "state directory");
      if (!st.isDirectory()) {
        throw new EntitlementStateError("io", "state parent is not a directory");
      }
      assertSecureDirMode(st.mode, "state directory");
    }
  }

  /**
   * Read and validate the current state file.
   * Returns null when the file does not exist.
   */
  async read(): Promise<EntitlementStateFile | null> {
    let st: fs.Stats;
    try {
      st = await fsp.lstat(this.filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") return null;
      throw new EntitlementStateError(
        "io",
        `failed to stat state file: ${code ?? "unknown"}`,
      );
    }

    assertNotSymlink(st, "state file");
    if (!st.isFile()) {
      throw new EntitlementStateError("corrupt", "state path is not a regular file");
    }
    if (st.size > this.maxBytes) {
      throw new EntitlementStateError("oversized", "entitlement state file oversized");
    }
    assertSecureFileMode(st.mode, "state file");

    // Parent directory should also be user-only when present.
    if (isPosix()) {
      try {
        const dirSt = await fsp.lstat(this.dirPath);
        assertNotSymlink(dirSt, "state directory");
        if (dirSt.isDirectory()) {
          assertSecureDirMode(dirSt.mode, "state directory");
        }
      } catch (err) {
        if (isEntitlementStateError(err)) throw err;
        // Missing parent while file exists is unexpected; surface as io.
        throw new EntitlementStateError("io", "failed to stat state directory");
      }
    }

    let raw: string;
    try {
      raw = await fsp.readFile(this.filePath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      throw new EntitlementStateError(
        "io",
        `failed to read state file: ${code ?? "unknown"}`,
      );
    }
    return parseEntitlementStateFile(raw, this.maxBytes);
  }

  /**
   * Atomically write a full state envelope.
   * Sequence: unique temp → write → fsync → rename → fsync directory.
   */
  async write(state: EntitlementStateFile): Promise<void> {
    const body = serializeEntitlementStateFile(state, this.maxBytes);
    await this.ensureParentDir();

    // Refuse to write through a symlink at the destination path.
    try {
      const existing = await fsp.lstat(this.filePath);
      assertNotSymlink(existing, "state file");
    } catch (err) {
      if (isEntitlementStateError(err)) throw err;
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        throw new EntitlementStateError(
          "io",
          `failed to lstat state file: ${code ?? "unknown"}`,
        );
      }
    }

    if (this.hooks.beforeWrite) {
      await this.hooks.beforeWrite();
    }

    const tmpName = `.state.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    const tmpPath = path.join(this.dirPath, tmpName);

    let fd: fsp.FileHandle | null = null;
    try {
      // Exclusive create with owner-only mode.
      fd = await fsp.open(tmpPath, "wx", STATE_FILE_MODE);
      await fd.writeFile(body, "utf8");
      await fd.sync();

      if (this.hooks.afterFsync) {
        await this.hooks.afterFsync();
      }

      await fd.close();
      fd = null;

      if (isPosix()) {
        // Ensure mode survived umask.
        await fsp.chmod(tmpPath, STATE_FILE_MODE);
      }

      if (this.hooks.beforeRename) {
        await this.hooks.beforeRename();
      }

      await fsp.rename(tmpPath, this.filePath);
      await fsyncDirectory(this.dirPath);

      if (isPosix()) {
        await fsp.chmod(this.filePath, STATE_FILE_MODE);
      }
    } catch (err) {
      // Best-effort temp cleanup; previous valid file remains if rename failed.
      if (fd) {
        try {
          await fd.close();
        } catch {
          /* ignore */
        }
      }
      try {
        await fsp.unlink(tmpPath);
      } catch {
        /* ignore */
      }
      if (isEntitlementStateError(err)) throw err;
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      throw new EntitlementStateError(
        "io",
        `atomic state write failed: ${code ?? (err as Error).message ?? "unknown"}`,
      );
    }
  }

  /**
   * Record a transient refresh failure without dropping a still-valid lease.
   *
   * Keeps previous `lease`, `deviceId`, `devicePublicKeyThumbprint`, and any
   * non-`none` authoritative denial. Updates `updatedAt` / `requestId` only.
   * When no previous state exists, writes a minimal empty envelope.
   */
  async writeTransientRefreshFailure(meta: {
    updatedAt: string;
    requestId: string | null;
    /** Used only when no previous state exists. */
    deviceId?: string;
    devicePublicKeyThumbprint?: string;
  }): Promise<EntitlementStateFile> {
    const prev = await this.read();
    const next: EntitlementStateFile = prev
      ? {
          ...prev,
          // Never invent an authoritative denial from a transient error.
          authoritativeState:
            prev.authoritativeState === "none"
              ? "none"
              : prev.authoritativeState,
          updatedAt: meta.updatedAt,
          requestId: meta.requestId,
          // Explicit: keep previous valid lease (including null).
          lease: prev.lease,
        }
      : {
          schema: 1,
          deviceId: meta.deviceId ?? "",
          devicePublicKeyThumbprint: meta.devicePublicKeyThumbprint ?? "",
          lease: null,
          authoritativeState: "none",
          updatedAt: meta.updatedAt,
          requestId: meta.requestId,
        };

    if (!prev) {
      if (!next.deviceId || !next.devicePublicKeyThumbprint) {
        throw new EntitlementStateError(
          "corrupt",
          "device identity required when no previous state exists",
        );
      }
    }

    await this.write(next);
    return next;
  }
}
