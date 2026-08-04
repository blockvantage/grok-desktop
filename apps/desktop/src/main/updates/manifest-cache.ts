/**
 * Atomic on-disk cache for the last verified release manifest and anti-rollback
 * state. Layout lives under userData; writes use temp → fsync → rename.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  existsSync,
  type PathLike,
} from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  parseSignedCompatibilityEnvelope,
  type SignedCompatibilityEnvelope,
} from "@grokdesk/shared";

export const MANIFEST_CACHE_FILENAME = "release-manifest-cache.json";

export type ManifestCacheRecord = {
  envelope: SignedCompatibilityEnvelope;
  payloadSha256: string;
  highestSequence: number;
  etag?: string;
  checkedAt: string;
};

export type ManifestCacheOptions = {
  /** Directory that will hold the cache file (typically under userData). */
  directory: string;
  fileName?: string;
};

export type LoadCacheResult =
  | { ok: true; record: ManifestCacheRecord }
  | { ok: false; code: "absent" | "corrupt"; message: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function parseCacheRecord(raw: unknown): ManifestCacheRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(o.payloadSha256) ||
    typeof o.highestSequence !== "number" ||
    !Number.isInteger(o.highestSequence) ||
    o.highestSequence < 0 ||
    !isNonEmptyString(o.checkedAt)
  ) {
    return null;
  }
  let envelope: SignedCompatibilityEnvelope;
  try {
    envelope = parseSignedCompatibilityEnvelope(o.envelope);
  } catch {
    return null;
  }
  if (o.etag !== undefined && typeof o.etag !== "string") return null;
  return {
    envelope,
    payloadSha256: o.payloadSha256,
    highestSequence: o.highestSequence,
    ...(typeof o.etag === "string" ? { etag: o.etag } : {}),
    checkedAt: o.checkedAt,
  };
}

/**
 * Write JSON atomically: unique temp file, fsync, rename over destination.
 * Best-effort chmod 0600 on POSIX; Windows ignores mode.
 */
export function atomicWriteFile(
  filePath: string,
  contents: string | Buffer,
  mode = 0o600,
): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  const fd = openSync(tmp, "w", mode);
  try {
    writeFileSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
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
}

export class ManifestCache {
  readonly filePath: string;

  constructor(options: ManifestCacheOptions) {
    this.filePath = path.join(
      options.directory,
      options.fileName ?? MANIFEST_CACHE_FILENAME,
    );
  }

  load(): LoadCacheResult {
    if (!existsSync(this.filePath)) {
      return { ok: false, code: "absent", message: "Manifest cache absent" };
    }
    let text: string;
    try {
      text = readFileSync(this.filePath, "utf8");
    } catch (err) {
      return {
        ok: false,
        code: "corrupt",
        message: `Manifest cache unreadable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        code: "corrupt",
        message: "Manifest cache is not valid JSON",
      };
    }
    const record = parseCacheRecord(parsed);
    if (!record) {
      return {
        ok: false,
        code: "corrupt",
        message: "Manifest cache record shape invalid",
      };
    }
    return { ok: true, record };
  }

  /**
   * Persist a verified envelope and anti-rollback cursor.
   * Rejects attempts to lower `highestSequence` or reuse a sequence with a
   * different payload hash (defense in depth alongside the verifier).
   */
  store(record: ManifestCacheRecord): void {
    const existing = this.load();
    if (existing.ok) {
      if (record.highestSequence < existing.record.highestSequence) {
        throw new Error("sequence_rollback");
      }
      if (
        record.highestSequence === existing.record.highestSequence &&
        record.payloadSha256 !== existing.record.payloadSha256
      ) {
        throw new Error("sequence_hash_mismatch");
      }
    }
    atomicWriteFile(this.filePath, `${JSON.stringify(record)}\n`);
  }

  clear(): void {
    try {
      unlinkSync(this.filePath);
    } catch {
      /* absent */
    }
  }
}

/** Test helper: read raw bytes without validation. */
export function readRawCacheFile(filePath: PathLike): string {
  return readFileSync(filePath, "utf8");
}
