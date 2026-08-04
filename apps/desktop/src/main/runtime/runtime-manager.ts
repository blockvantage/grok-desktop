/**
 * Managed Grok runtime install transaction.
 *
 * Flow: verify staged artifact → promote into versioned dir → write
 * installation.json → optional atomic pointer switch when work is idle.
 *
 * Never switches while work is active (`isIdle` admission). Durable
 * install-journal.json recovers crashes mid-transaction. Pre-switch failures
 * preserve current; post-switch failures restore previous and rebuild.
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import path from "node:path";
import type {
  CanonicalRuntimeTarget,
  Provenance,
  SigningPolicy,
} from "@grokdesk/shared";
import {
  downloadArtifact,
  type ArtifactDownloadOptions,
  type ArtifactDownloadRequest,
} from "./artifact-downloader.js";
import {
  assertNoSymlinkEscape,
  assertPathUnderRoot,
  installJournalPath,
  mkdirUserOnly,
  quarantineDir,
  runtimeBinaryName,
  stagingDir,
} from "./runtime-paths.js";
import {
  RuntimeStore,
  atomicWriteJsonFile,
  sha256File,
} from "./runtime-store.js";
import {
  verifyRuntimeBinary,
  type RuntimeVerifierDeps,
  type VerifyRuntimeResult,
} from "./runtime-verifier.js";
import {
  RUNTIME_INSTALLATION_SCHEMA_VERSION,
  type RuntimeInstallationRecord,
  type RuntimeInstallationRef,
  type RuntimeCurrentPointer,
  type PlatformSigningResult,
  type RuntimeProbeResult,
} from "./runtime-types.js";

export const INSTALL_JOURNAL_SCHEMA_VERSION = 1 as const;

export type InstallJournalState =
  | "idle"
  | "downloading"
  | "verifying"
  | "promoting"
  | "installation_written"
  | "waiting_for_idle"
  | "switching"
  | "switched"
  | "rolling_back"
  | "failed";

export type InstallJournal = {
  schemaVersion: typeof INSTALL_JOURNAL_SCHEMA_VERSION;
  state: InstallJournalState;
  artifactId: string;
  version: string;
  target: CanonicalRuntimeTarget;
  digestSha256: string;
  sizeBytes: number;
  stagingBinaryPath?: string;
  versionDir?: string;
  binaryPath?: string;
  previousCurrent?: RuntimeInstallationRef | null;
  error?: string;
  updatedAt: string;
  manifestSequence: number;
  manifestKeyId: string;
  switchWhenIdle: boolean;
};

export type InstallRuntimeRequest = {
  /** Absolute path to the staged binary (already downloaded). */
  stagingBinaryPath: string;
  artifactId: string;
  version: string;
  target: CanonicalRuntimeTarget;
  expectedSha256: string;
  expectedSizeBytes: number;
  provenance: Provenance;
  signingPolicy: SigningPolicy;
  requiredCapabilities?: readonly string[];
  declaredCapabilities?: readonly string[];
  manifestSequence: number;
  manifestKeyId: string;
  /**
   * When true (default), switch current.json after install if `isIdle()`.
   * When false, leave a complete install without switching the pointer.
   */
  switchWhenIdle?: boolean;
};

export type InstallFromDownloadRequest = Omit<
  InstallRuntimeRequest,
  "stagingBinaryPath"
> & {
  download: ArtifactDownloadRequest;
  downloadOptions?: ArtifactDownloadOptions;
};

export type InstallRuntimeResult =
  | {
      ok: true;
      ref: RuntimeInstallationRef;
      binaryPath: string;
      record: RuntimeInstallationRecord;
      /** True when current.json now points at this install. */
      switched: boolean;
      /** True when install is complete but pointer wait deferred (busy). */
      waitingForIdle: boolean;
      pointer: RuntimeCurrentPointer | null;
      notes: string[];
    }
  | {
      ok: false;
      code: InstallErrorCode;
      message: string;
      notes: string[];
      /** Current pointer left unchanged on pre-switch failure. */
      pointerPreserved: boolean;
    };

export type InstallErrorCode =
  | "not_idle"
  | "verify_failed"
  | "promote_failed"
  | "switch_failed"
  | "gateway_rebuild_failed"
  | "rollback_failed"
  | "disk_not_writable"
  | "download_failed"
  | "invalid_request"
  | "busy"
  | "journal_corrupt";

export type RuntimeManagerOptions = {
  store: RuntimeStore;
  /**
   * Admission control: pointer switch (and optional full install) only when idle.
   * Required — never switch while work is active.
   */
  isIdle: () => boolean | Promise<boolean>;
  /**
   * After a successful pointer switch (or rollback), rebuild the gateway
   * engine against the explicit binary path.
   */
  rebuildGateway?: (binaryPath: string) => void | Promise<void>;
  now?: () => Date;
  verifierDeps?: RuntimeVerifierDeps;
  /**
   * When true, refuse the entire install transaction if not idle
   * (not only the pointer switch). Default false — download/verify/promote
   * may proceed while busy; only switch waits.
   */
  requireIdleForInstall?: boolean;
};

function isSha256Hex(v: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(v);
}

function parseInstallJournal(raw: unknown): InstallJournal | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== INSTALL_JOURNAL_SCHEMA_VERSION) return null;
  if (typeof o.state !== "string") return null;
  if (typeof o.artifactId !== "string" || o.artifactId.length === 0) return null;
  if (typeof o.version !== "string" || o.version.length === 0) return null;
  if (typeof o.target !== "string") return null;
  if (typeof o.digestSha256 !== "string" || !isSha256Hex(o.digestSha256)) {
    return null;
  }
  if (typeof o.sizeBytes !== "number" || !Number.isFinite(o.sizeBytes)) {
    return null;
  }
  if (typeof o.updatedAt !== "string") return null;
  if (
    typeof o.manifestSequence !== "number" ||
    !Number.isInteger(o.manifestSequence)
  ) {
    return null;
  }
  if (typeof o.manifestKeyId !== "string") return null;
  if (typeof o.switchWhenIdle !== "boolean") return null;

  let previousCurrent: RuntimeInstallationRef | null | undefined;
  if (o.previousCurrent === null) {
    previousCurrent = null;
  } else if (o.previousCurrent && typeof o.previousCurrent === "object") {
    const p = o.previousCurrent as Record<string, unknown>;
    if (
      typeof p.version === "string" &&
      typeof p.target === "string" &&
      typeof p.digestSha256 === "string" &&
      isSha256Hex(p.digestSha256)
    ) {
      previousCurrent = {
        version: p.version,
        target: p.target as CanonicalRuntimeTarget,
        digestSha256: p.digestSha256.toLowerCase(),
      };
    } else {
      return null;
    }
  }

  return {
    schemaVersion: INSTALL_JOURNAL_SCHEMA_VERSION,
    state: o.state as InstallJournalState,
    artifactId: o.artifactId,
    version: o.version,
    target: o.target as CanonicalRuntimeTarget,
    digestSha256: o.digestSha256.toLowerCase(),
    sizeBytes: o.sizeBytes,
    ...(typeof o.stagingBinaryPath === "string"
      ? { stagingBinaryPath: o.stagingBinaryPath }
      : {}),
    ...(typeof o.versionDir === "string" ? { versionDir: o.versionDir } : {}),
    ...(typeof o.binaryPath === "string" ? { binaryPath: o.binaryPath } : {}),
    ...(previousCurrent !== undefined ? { previousCurrent } : {}),
    ...(typeof o.error === "string" ? { error: o.error } : {}),
    updatedAt: o.updatedAt,
    manifestSequence: o.manifestSequence,
    manifestKeyId: o.manifestKeyId,
    switchWhenIdle: o.switchWhenIdle,
  };
}

function safeUnlink(p: string): void {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* best-effort */
  }
}

function promoteBinary(
  stagingBinaryPath: string,
  destBinaryPath: string,
  root: string,
): void {
  assertPathUnderRoot(destBinaryPath, root);
  assertNoSymlinkEscape(path.dirname(destBinaryPath), root);
  mkdirUserOnly(path.dirname(destBinaryPath));

  // Prefer atomic rename within the same filesystem; fall back to copy+unlink.
  try {
    if (existsSync(destBinaryPath)) {
      unlinkSync(destBinaryPath);
    }
    renameSync(stagingBinaryPath, destBinaryPath);
  } catch {
    copyFileSync(stagingBinaryPath, destBinaryPath);
    try {
      unlinkSync(stagingBinaryPath);
    } catch {
      /* leave staging */
    }
  }

  // Ensure still not world-writable; mode refined after verify on macOS.
  try {
    chmodSync(destBinaryPath, 0o755);
  } catch {
    /* Windows */
  }
}

export class RuntimeManager {
  readonly store: RuntimeStore;
  private readonly isIdle: () => boolean | Promise<boolean>;
  private readonly rebuildGateway?: (
    binaryPath: string,
  ) => void | Promise<void>;
  private readonly now: () => Date;
  private readonly verifierDeps: RuntimeVerifierDeps;
  private readonly requireIdleForInstall: boolean;
  /** Serialize install transactions. */
  private busy = false;

  constructor(options: RuntimeManagerOptions) {
    this.store = options.store;
    this.isIdle = options.isIdle;
    this.rebuildGateway = options.rebuildGateway;
    this.now = options.now ?? (() => new Date());
    this.verifierDeps = options.verifierDeps ?? {};
    this.requireIdleForInstall = options.requireIdleForInstall ?? false;
  }

  journalPath(): string {
    return installJournalPath(this.store.userData);
  }

  loadJournal(): InstallJournal | null {
    const file = this.journalPath();
    if (!existsSync(file)) return null;
    try {
      const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
      return parseInstallJournal(raw);
    } catch {
      return null;
    }
  }

  private writeJournal(journal: InstallJournal): void {
    this.store.ensureLayout();
    const file = this.journalPath();
    atomicWriteJsonFile(file, `${JSON.stringify(journal)}\n`, { mode: 0o600 });
  }

  private clearJournal(): void {
    safeUnlink(this.journalPath());
  }

  private stamp(
    partial: Omit<InstallJournal, "schemaVersion" | "updatedAt">,
  ): InstallJournal {
    return {
      ...partial,
      schemaVersion: INSTALL_JOURNAL_SCHEMA_VERSION,
      updatedAt: this.now().toISOString(),
    };
  }

  private async idle(): Promise<boolean> {
    return Boolean(await this.isIdle());
  }

  /**
   * Install from an already-downloaded staging binary.
   */
  async install(request: InstallRuntimeRequest): Promise<InstallRuntimeResult> {
    if (this.busy) {
      return {
        ok: false,
        code: "busy",
        message: "another install transaction is in progress",
        notes: ["busy"],
        pointerPreserved: true,
      };
    }
    this.busy = true;
    const notes: string[] = [];
    try {
      return await this.installUnlocked(request, notes);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Download into staging then run the install transaction.
   */
  async installFromDownload(
    request: InstallFromDownloadRequest,
  ): Promise<InstallRuntimeResult> {
    if (this.busy) {
      return {
        ok: false,
        code: "busy",
        message: "another install transaction is in progress",
        notes: ["busy"],
        pointerPreserved: true,
      };
    }
    this.busy = true;
    const notes: string[] = [];
    try {
      if (
        request.download.expectedSha256.toLowerCase() !==
          request.expectedSha256.toLowerCase() ||
        request.download.expectedSize !== request.expectedSizeBytes
      ) {
        return {
          ok: false,
          code: "invalid_request",
          message: "download digest/size must match signed manifest request",
          notes: ["download_manifest_mismatch"],
          pointerPreserved: true,
        };
      }

      if (this.requireIdleForInstall && !(await this.idle())) {
        return {
          ok: false,
          code: "not_idle",
          message: "work active; install deferred",
          notes: ["not_idle"],
          pointerPreserved: true,
        };
      }

      this.store.ensureLayout();
      const journalBase = {
        state: "downloading" as const,
        artifactId: request.artifactId,
        version: request.version,
        target: request.target,
        digestSha256: request.expectedSha256.toLowerCase(),
        sizeBytes: request.expectedSizeBytes,
        manifestSequence: request.manifestSequence,
        manifestKeyId: request.manifestKeyId,
        switchWhenIdle: request.switchWhenIdle !== false,
      };
      this.writeJournal(this.stamp(journalBase));

      const dl = await downloadArtifact(request.download, {
        ...request.downloadOptions,
        quarantineDir:
          request.downloadOptions?.quarantineDir ??
          quarantineDir(this.store.userData),
      });
      if (!dl.ok) {
        this.writeJournal(
          this.stamp({
            ...journalBase,
            state: "failed",
            error: `${dl.code}:${dl.message}`,
          }),
        );
        return {
          ok: false,
          code: "download_failed",
          message: dl.message,
          notes: [`download:${dl.code}`],
          pointerPreserved: true,
        };
      }
      notes.push("downloaded");

      if (
        dl.sha256.toLowerCase() !== request.expectedSha256.toLowerCase() ||
        dl.sizeBytes !== request.expectedSizeBytes
      ) {
        this.writeJournal(
          this.stamp({
            ...journalBase,
            state: "failed",
            error: "download_manifest_mismatch",
          }),
        );
        return {
          ok: false,
          code: "invalid_request",
          message: "downloader result diverged from signed manifest request",
          notes: [...notes, "download_manifest_mismatch"],
          pointerPreserved: true,
        };
      }

      return await this.installUnlocked(
        {
          ...request,
          stagingBinaryPath: dl.path,
        },
        notes,
      );
    } finally {
      this.busy = false;
    }
  }

  private async installUnlocked(
    request: InstallRuntimeRequest,
    notes: string[],
  ): Promise<InstallRuntimeResult> {
    if (this.requireIdleForInstall && !(await this.idle())) {
      return {
        ok: false,
        code: "not_idle",
        message: "work active; install deferred",
        notes: [...notes, "not_idle"],
        pointerPreserved: true,
      };
    }

    if (!request.stagingBinaryPath || !existsSync(request.stagingBinaryPath)) {
      return {
        ok: false,
        code: "invalid_request",
        message: "staging binary missing",
        notes: [...notes, "staging_missing"],
        pointerPreserved: true,
      };
    }

    // Writable layout check.
    try {
      this.store.ensureLayout();
      const probe = path.join(
        stagingDir(this.store.userData),
        `.writecheck-${Date.now()}`,
      );
      writeFileSync(probe, "ok", { mode: 0o600 });
      unlinkSync(probe);
    } catch (err) {
      return {
        ok: false,
        code: "disk_not_writable",
        message: err instanceof Error ? err.message : String(err),
        notes: [...notes, "disk_not_writable"],
        pointerPreserved: true,
      };
    }

    const switchWhenIdle = request.switchWhenIdle !== false;
    const prior = this.store.loadPointer();
    const previousCurrent = prior.ok ? prior.pointer.current : null;

    const journalBase = {
      artifactId: request.artifactId,
      version: request.version,
      target: request.target,
      digestSha256: request.expectedSha256.toLowerCase(),
      sizeBytes: request.expectedSizeBytes,
      stagingBinaryPath: path.resolve(request.stagingBinaryPath),
      previousCurrent,
      manifestSequence: request.manifestSequence,
      manifestKeyId: request.manifestKeyId,
      switchWhenIdle,
    };

    // --- verify ---
    this.writeJournal(
      this.stamp({ ...journalBase, state: "verifying" }),
    );
    notes.push("verifying");

    const verified = await verifyRuntimeBinary(
      {
        binaryPath: request.stagingBinaryPath,
        expectedVersion: request.version,
        expectedSha256: request.expectedSha256,
        expectedSizeBytes: request.expectedSizeBytes,
        target: request.target,
        signingPolicy: request.signingPolicy,
        requiredCapabilities: request.requiredCapabilities,
        declaredCapabilities: request.declaredCapabilities,
      },
      this.verifierDeps,
    );

    if (!verified.ok) {
      this.writeJournal(
        this.stamp({
          ...journalBase,
          state: "failed",
          error: `${verified.code}:${verified.message}`,
        }),
      );
      return {
        ok: false,
        code: "verify_failed",
        message: verified.message,
        notes: [...notes, `verify:${verified.code}`],
        pointerPreserved: true,
      };
    }
    notes.push("verified");

    // --- promote into versioned directory ---
    this.writeJournal(
      this.stamp({ ...journalBase, state: "promoting" }),
    );
    notes.push("promoting");

    const versionDir = this.store.versionDir(request.version, request.target);
    const destBinary = this.store.binaryPath(request.version, request.target);

    try {
      // Idempotent: same digest already complete → skip promote.
      const existing = this.store.loadInstallation(
        request.version,
        request.target,
      );
      if (
        existing?.complete &&
        existing.digestSha256 === verified.digestSha256 &&
        existsSync(destBinary) &&
        sha256File(destBinary) === verified.digestSha256
      ) {
        notes.push("already_installed");
      } else {
        // If a different tree exists, remove it before promote.
        if (existsSync(versionDir)) {
          const q = path.join(
            quarantineDir(this.store.userData),
            `replace-${request.version}-${Date.now()}`,
          );
          try {
            renameSync(versionDir, q);
            rmSync(q, { recursive: true, force: true });
          } catch {
            rmSync(versionDir, { recursive: true, force: true });
          }
        }
        promoteBinary(
          path.resolve(request.stagingBinaryPath),
          destBinary,
          this.store.root,
        );
        // Re-hash after promote.
        const onDisk = sha256File(destBinary);
        if (onDisk !== verified.digestSha256) {
          throw new Error(`promote_digest_mismatch:${onDisk}`);
        }
        // Size check.
        if (statSync(destBinary).size !== verified.sizeBytes) {
          throw new Error("promote_size_mismatch");
        }
      }
    } catch (err) {
      this.writeJournal(
        this.stamp({
          ...journalBase,
          state: "failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return {
        ok: false,
        code: "promote_failed",
        message: err instanceof Error ? err.message : String(err),
        notes: [...notes, "promote_failed"],
        pointerPreserved: true,
      };
    }

    const record = this.buildInstallationRecord(request, verified);
    try {
      this.store.writeInstallation(record);
    } catch (err) {
      this.writeJournal(
        this.stamp({
          ...journalBase,
          state: "failed",
          versionDir,
          binaryPath: destBinary,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return {
        ok: false,
        code: "promote_failed",
        message: err instanceof Error ? err.message : String(err),
        notes: [...notes, "installation_write_failed"],
        pointerPreserved: true,
      };
    }
    notes.push("installation_written");

    const ref: RuntimeInstallationRef = {
      version: request.version,
      target: request.target,
      digestSha256: verified.digestSha256,
    };

    this.writeJournal(
      this.stamp({
        ...journalBase,
        state: "installation_written",
        versionDir,
        binaryPath: destBinary,
        digestSha256: verified.digestSha256,
        sizeBytes: verified.sizeBytes,
      }),
    );

    // Clean empty staging parent if possible.
    try {
      const stagingParent = path.dirname(path.resolve(request.stagingBinaryPath));
      if (
        stagingParent.startsWith(stagingDir(this.store.userData)) &&
        existsSync(stagingParent)
      ) {
        // Only remove leftover meta/part if binary was moved.
        for (const name of ["grok.part", "grok.part.meta.json", "artifact.part"]) {
          safeUnlink(path.join(stagingParent, name));
        }
      }
    } catch {
      /* ignore */
    }

    if (!switchWhenIdle) {
      this.clearJournal();
      const ptr = this.store.loadPointer();
      return {
        ok: true,
        ref,
        binaryPath: destBinary,
        record,
        switched: false,
        waitingForIdle: false,
        pointer: ptr.ok ? ptr.pointer : null,
        notes: [...notes, "switch_skipped"],
      };
    }

    // --- optional pointer switch when idle ---
    if (!(await this.idle())) {
      this.writeJournal(
        this.stamp({
          ...journalBase,
          state: "waiting_for_idle",
          versionDir,
          binaryPath: destBinary,
          digestSha256: verified.digestSha256,
          sizeBytes: verified.sizeBytes,
        }),
      );
      notes.push("waiting_for_idle");
      const ptr = this.store.loadPointer();
      return {
        ok: true,
        ref,
        binaryPath: destBinary,
        record,
        switched: false,
        waitingForIdle: true,
        pointer: ptr.ok ? ptr.pointer : null,
        notes,
      };
    }

    return this.switchToRef(ref, previousCurrent, notes, record, destBinary);
  }

  /**
   * Attempt pointer switch for a complete install. Used after idle wait and
   * by journal recovery.
   */
  async trySwitchInstalled(
    ref: RuntimeInstallationRef,
  ): Promise<InstallRuntimeResult> {
    if (this.busy) {
      return {
        ok: false,
        code: "busy",
        message: "another install transaction is in progress",
        notes: ["busy"],
        pointerPreserved: true,
      };
    }
    this.busy = true;
    try {
      if (!(await this.idle())) {
        return {
          ok: false,
          code: "not_idle",
          message: "work active; switch deferred",
          notes: ["not_idle"],
          pointerPreserved: true,
        };
      }
      const record = this.store.loadInstallation(ref.version, ref.target);
      if (!record?.complete) {
        return {
          ok: false,
          code: "switch_failed",
          message: "installation incomplete",
          notes: ["incomplete"],
          pointerPreserved: true,
        };
      }
      const prior = this.store.loadPointer();
      const previousCurrent = prior.ok ? prior.pointer.current : null;
      const binaryPath = this.store.binaryPath(ref.version, ref.target);
      return await this.switchToRef(
        ref,
        previousCurrent,
        ["try_switch"],
        record,
        binaryPath,
      );
    } finally {
      this.busy = false;
    }
  }

  private async switchToRef(
    ref: RuntimeInstallationRef,
    previousCurrent: RuntimeInstallationRef | null,
    notes: string[],
    record: RuntimeInstallationRecord,
    binaryPath: string,
  ): Promise<InstallRuntimeResult> {
    // Do not set previous to self.
    const previous =
      previousCurrent &&
      !(
        previousCurrent.version === ref.version &&
        previousCurrent.digestSha256 === ref.digestSha256
      )
        ? previousCurrent
        : null;

    this.writeJournal(
      this.stamp({
        state: "switching",
        artifactId: record.artifactId,
        version: ref.version,
        target: ref.target,
        digestSha256: ref.digestSha256,
        sizeBytes: record.sizeBytes,
        binaryPath,
        previousCurrent: previous,
        manifestSequence: record.manifestSequence,
        manifestKeyId: record.manifestKeyId,
        switchWhenIdle: true,
      }),
    );
    notes.push("switching");

    let pointer: RuntimeCurrentPointer;
    try {
      pointer = this.store.switchPointer({
        current: ref,
        previous,
      });
    } catch (err) {
      this.writeJournal(
        this.stamp({
          state: "failed",
          artifactId: record.artifactId,
          version: ref.version,
          target: ref.target,
          digestSha256: ref.digestSha256,
          sizeBytes: record.sizeBytes,
          previousCurrent: previous,
          error: err instanceof Error ? err.message : String(err),
          manifestSequence: record.manifestSequence,
          manifestKeyId: record.manifestKeyId,
          switchWhenIdle: true,
        }),
      );
      return {
        ok: false,
        code: "switch_failed",
        message: err instanceof Error ? err.message : String(err),
        notes: [...notes, "switch_failed"],
        pointerPreserved: true,
      };
    }
    notes.push("switched");

    if (this.rebuildGateway) {
      try {
        await this.rebuildGateway(binaryPath);
        notes.push("gateway_rebuilt");
      } catch (err) {
        notes.push("gateway_rebuild_failed");
        // Post-switch failure: restore previous pointer and rebuild it.
        const rollback = await this.rollbackPointer(
          previous,
          notes,
          record,
          ref,
        );
        if (!rollback.ok) {
          return rollback;
        }
        return {
          ok: false,
          code: "gateway_rebuild_failed",
          message: err instanceof Error ? err.message : String(err),
          notes: rollback.notes,
          pointerPreserved: false,
        };
      }
    }

    this.writeJournal(
      this.stamp({
        state: "switched",
        artifactId: record.artifactId,
        version: ref.version,
        target: ref.target,
        digestSha256: ref.digestSha256,
        sizeBytes: record.sizeBytes,
        binaryPath,
        previousCurrent: previous,
        manifestSequence: record.manifestSequence,
        manifestKeyId: record.manifestKeyId,
        switchWhenIdle: true,
      }),
    );
    this.clearJournal();

    return {
      ok: true,
      ref,
      binaryPath,
      record,
      switched: true,
      waitingForIdle: false,
      pointer,
      notes,
    };
  }

  private async rollbackPointer(
    previous: RuntimeInstallationRef | null,
    notes: string[],
    record: RuntimeInstallationRecord,
    failedRef: RuntimeInstallationRef,
  ): Promise<InstallRuntimeResult> {
    this.writeJournal(
      this.stamp({
        state: "rolling_back",
        artifactId: record.artifactId,
        version: failedRef.version,
        target: failedRef.target,
        digestSha256: failedRef.digestSha256,
        sizeBytes: record.sizeBytes,
        previousCurrent: previous,
        manifestSequence: record.manifestSequence,
        manifestKeyId: record.manifestKeyId,
        switchWhenIdle: true,
      }),
    );
    notes.push("rolling_back");

    if (!previous) {
      this.writeJournal(
        this.stamp({
          state: "failed",
          artifactId: record.artifactId,
          version: failedRef.version,
          target: failedRef.target,
          digestSha256: failedRef.digestSha256,
          sizeBytes: record.sizeBytes,
          error: "no_previous_to_rollback",
          manifestSequence: record.manifestSequence,
          manifestKeyId: record.manifestKeyId,
          switchWhenIdle: true,
        }),
      );
      return {
        ok: false,
        code: "rollback_failed",
        message: "no previous runtime to restore after switch failure",
        notes: [...notes, "no_previous"],
        pointerPreserved: false,
      };
    }

    try {
      const pointer = this.store.switchPointer({
        current: previous,
        previous: null,
      });
      const prevBinary = this.store.binaryPath(previous.version, previous.target);
      if (this.rebuildGateway) {
        await this.rebuildGateway(prevBinary);
        notes.push("gateway_restored");
      }
      this.clearJournal();
      return {
        ok: false,
        code: "gateway_rebuild_failed",
        message: "rolled back to previous after post-switch failure",
        notes: [...notes, "rolled_back"],
        pointerPreserved: false,
        // not a success shape — caller maps this
      };
    } catch (err) {
      this.writeJournal(
        this.stamp({
          state: "failed",
          artifactId: record.artifactId,
          version: failedRef.version,
          target: failedRef.target,
          digestSha256: failedRef.digestSha256,
          sizeBytes: record.sizeBytes,
          error: err instanceof Error ? err.message : String(err),
          manifestSequence: record.manifestSequence,
          manifestKeyId: record.manifestKeyId,
          switchWhenIdle: true,
        }),
      );
      return {
        ok: false,
        code: "rollback_failed",
        message: err instanceof Error ? err.message : String(err),
        notes: [...notes, "rollback_failed"],
        pointerPreserved: false,
      };
    }
  }

  private buildInstallationRecord(
    request: InstallRuntimeRequest,
    verified: Extract<VerifyRuntimeResult, { ok: true }>,
  ): RuntimeInstallationRecord {
    return {
      schemaVersion: RUNTIME_INSTALLATION_SCHEMA_VERSION,
      artifactId: request.artifactId,
      version: request.version,
      target: request.target,
      digestSha256: verified.digestSha256,
      sizeBytes: verified.sizeBytes,
      provenance: request.provenance,
      manifestSequence: request.manifestSequence,
      manifestKeyId: request.manifestKeyId,
      installedAt: this.now().toISOString(),
      platformSigning: verified.platformSigning,
      probes: verified.probes,
      complete: true,
      capabilities: verified.capabilities,
    };
  }

  /**
   * Recover an interrupted install journal on startup.
   * - verifying/promoting/downloading incomplete → mark failed, preserve pointer
   * - installation_written / waiting_for_idle → keep install; switch if idle
   * - switching mid-flight → rely on pointer recovery; clear or resume
   */
  async recoverInstallJournal(): Promise<{
    journal: InstallJournal | null;
    action: string;
    installResult?: InstallRuntimeResult;
  }> {
    const file = this.journalPath();
    if (!existsSync(file)) {
      return { journal: null, action: "none" };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      safeUnlink(file);
      return { journal: null, action: "cleared_corrupt" };
    }

    const journal = parseInstallJournal(raw);
    if (!journal) {
      safeUnlink(file);
      return { journal: null, action: "cleared_corrupt" };
    }

    switch (journal.state) {
      case "idle":
      case "switched":
        this.clearJournal();
        return { journal, action: "cleared_terminal" };

      case "failed":
        return { journal, action: "left_failed" };

      case "downloading":
      case "verifying":
      case "promoting":
        // Incomplete — do not touch current pointer. Drop journal.
        this.clearJournal();
        return { journal, action: "abandoned_pre_install" };

      case "installation_written":
      case "waiting_for_idle": {
        const ref: RuntimeInstallationRef = {
          version: journal.version,
          target: journal.target,
          digestSha256: journal.digestSha256,
        };
        const verified = this.store.isCompleteVerifiedInstall(ref);
        if (!verified.ok) {
          this.clearJournal();
          return { journal, action: "abandoned_incomplete_install" };
        }
        if (!journal.switchWhenIdle) {
          this.clearJournal();
          return { journal, action: "install_ready_no_switch" };
        }
        if (!(await this.idle())) {
          // Keep waiting journal.
          if (journal.state !== "waiting_for_idle") {
            this.writeJournal(
              this.stamp({ ...journal, state: "waiting_for_idle" }),
            );
          }
          return { journal, action: "still_waiting_for_idle" };
        }
        const result = await this.trySwitchInstalled(ref);
        return {
          journal,
          action: result.ok && result.switched ? "switched_on_recover" : "switch_attempted",
          installResult: result,
        };
      }

      case "switching":
      case "rolling_back": {
        // Pointer atomic write may have completed; recovery module handles
        // current.json. Clear install journal if pointer is consistent.
        const ptr = this.store.loadPointer();
        if (
          ptr.ok &&
          ptr.pointer.current.version === journal.version &&
          ptr.pointer.current.digestSha256 === journal.digestSha256
        ) {
          this.clearJournal();
          return { journal, action: "switch_already_committed" };
        }
        if (journal.previousCurrent) {
          const prevOk = this.store.isCompleteVerifiedInstall(
            journal.previousCurrent,
          );
          if (prevOk.ok) {
            try {
              this.store.switchPointer({
                current: journal.previousCurrent,
                previous: null,
              });
              if (this.rebuildGateway) {
                await this.rebuildGateway(prevOk.binaryPath);
              }
              this.clearJournal();
              return { journal, action: "rolled_back_from_switching" };
            } catch {
              return { journal, action: "rollback_from_switching_failed" };
            }
          }
        }
        this.clearJournal();
        return { journal, action: "cleared_switching_no_previous" };
      }

      default:
        this.clearJournal();
        return { journal, action: "cleared_unknown" };
    }
  }
}

/** Staging destination helpers for download+install. */
export function stagingArtifactDir(
  userData: string,
  artifactId: string,
): string {
  const safe = artifactId.replace(/[^A-Za-z0-9._+-]/g, "_").slice(0, 128);
  return path.join(stagingDir(userData), safe);
}

export function stagingBinaryFileName(target: CanonicalRuntimeTarget): string {
  return runtimeBinaryName(target);
}

export type {
  PlatformSigningResult,
  RuntimeProbeResult,
};
