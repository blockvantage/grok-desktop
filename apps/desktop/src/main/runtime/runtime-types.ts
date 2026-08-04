/**
 * On-disk types for Desk-managed side-by-side Grok runtimes.
 *
 * Layout under userData:
 *   runtimes/grok/<version>/<target>/grok[.exe]
 *   runtimes/grok/<version>/<target>/installation.json
 *   runtimes/grok/current.json
 *   runtimes/grok/staging/
 *   runtimes/grok/quarantine/
 */
import type { CanonicalRuntimeTarget, Provenance } from "@grokdesk/shared";

export const RUNTIME_POINTER_SCHEMA_VERSION = 1 as const;
export const RUNTIME_INSTALLATION_SCHEMA_VERSION = 1 as const;

/** Platform code-signing / Authenticode check result (safe fields only). */
export type PlatformSigningResult = {
  checked: boolean;
  valid: boolean;
  /** macOS Team ID when extracted. */
  teamId?: string;
  /** Windows Authenticode status string when present. */
  status?: string;
  /** Windows subject / thumbprint match notes (no raw cert blobs). */
  subject?: string;
  thumbprint?: string;
  detail?: string;
};

/** Non-billable probe outcome (`--version`, `--help`, `agent --help`). */
export type RuntimeProbeResult = {
  /** Probe identifier, e.g. "version" | "help" | "agent_help". */
  name: string;
  ok: boolean;
  /** Cap-safe truncated stdout/stderr summary. */
  summary?: string;
  durationMs?: number;
};

/**
 * Per-install metadata written next to the binary once verification completes.
 * Incomplete / missing records must never be selected as current.
 */
export type RuntimeInstallationRecord = {
  schemaVersion: typeof RUNTIME_INSTALLATION_SCHEMA_VERSION;
  artifactId: string;
  version: string;
  target: CanonicalRuntimeTarget;
  /** Lowercase hex SHA-256 of the installed binary. */
  digestSha256: string;
  sizeBytes: number;
  provenance: Provenance;
  manifestSequence: number;
  manifestKeyId: string;
  installedAt: string;
  platformSigning: PlatformSigningResult;
  probes: RuntimeProbeResult[];
  /**
   * Set true only after digest, platform signature (when required), and probes
   * all pass and the binary is in its final version directory.
   */
  complete: boolean;
  capabilities?: string[];
};

/** Lightweight pointer entry embedded in current.json. */
export type RuntimeInstallationRef = {
  version: string;
  target: CanonicalRuntimeTarget;
  digestSha256: string;
};

/**
 * Atomic selection pointer. `previous` is retained for automatic rollback.
 * Never points at staging/ or quarantine/.
 */
export type RuntimeCurrentPointer = {
  schemaVersion: typeof RUNTIME_POINTER_SCHEMA_VERSION;
  current: RuntimeInstallationRef;
  previous: RuntimeInstallationRef | null;
  updatedAt: string;
};

/**
 * Version keys retained by GC. Journal entries from the update coordinator
 * may reference in-flight staged versions that must not be deleted yet.
 */
export type RuntimeJournalRefs = {
  /** Version directory names referenced by the durable update journal. */
  versions: readonly string[];
  /** Absolute staging paths still owned by an in-flight transaction. */
  stagingPaths?: readonly string[];
};

export type RuntimeRecoveryResult = {
  pointer: RuntimeCurrentPointer | null;
  /**
   * Path to the selected binary when recovery found a complete installation.
   * Null when no verified runtime is available.
   */
  binaryPath: string | null;
  /** Human-readable recovery notes for diagnostics (no secrets). */
  notes: string[];
  /** Versions removed by GC during recovery. */
  gcRemoved: string[];
  /** Staging entries cleaned as abandoned. */
  stagingCleaned: string[];
};

/** Injectable crash points for atomic pointer write tests. */
export type AtomicPointerCrashPoint =
  | "before_temp_write"
  | "after_temp_write"
  | "after_fsync"
  | "before_rename"
  | "after_rename"
  | "after_backup_cleanup";

export class AtomicWriteCrashError extends Error {
  readonly crashPoint: AtomicPointerCrashPoint;

  constructor(crashPoint: AtomicPointerCrashPoint) {
    super(`atomic_write_crash:${crashPoint}`);
    this.name = "AtomicWriteCrashError";
    this.crashPoint = crashPoint;
  }
}

export function isAtomicWriteCrashError(
  err: unknown,
): err is AtomicWriteCrashError {
  return err instanceof AtomicWriteCrashError;
}
