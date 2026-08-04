/**
 * Coordinates one synchronized Desk/Grok pair update transaction.
 *
 * Resolve once → stage/verify Grok without switching → stage exact Desk →
 * re-resolve against the same manifest sequence → staged → wait for idle →
 * install → restart → post-update health → commit.
 *
 * Grok-only is allowed only when installed Desk stays compatible.
 * Desk-only is allowed only when installed Grok remains compatible.
 * Never installs/switches while work is active (`isIdle`).
 */
import type {
  CanonicalRuntimeTarget,
  ReleaseChannel,
  ResolvedPair,
  UpdatePhase,
  UpdateStatus,
} from "@grokdesk/shared";
import { compareSemver, idleUpdateStatus } from "@grokdesk/shared";
import {
  UpdateJournalStore,
  planJournalRecovery,
  type CustomerUpdateAction,
  type InstalledPairRef,
  type PreviousRuntimeRef,
  type StagedArtifactRef,
  type TargetPairRef,
  type UpdateJournalRecord,
} from "./update-journal.js";
import {
  verifyPostUpdateHealth,
  type PostUpdateHealthResult,
  type UpdateHealthDeps,
} from "./update-health.js";
import {
  evaluateSecurityPolicy,
  type SecurityPolicySnapshot,
  type TrustedTimeFloor,
  type ActiveRuntimeRef,
} from "./security-deadline.js";
import type { Revocation } from "@grokdesk/shared";

export type ResolvedPairSnapshot = {
  pairId: string;
  channel: ReleaseChannel;
  target: CanonicalRuntimeTarget;
  deskVersion: string;
  grokVersion: string;
  deskArtifactId: string;
  grokArtifactId: string;
  capabilities: readonly string[];
  deskSha256: string;
  grokSha256: string;
  deskSizeBytes: number;
  grokSizeBytes: number;
  /** Manifest sequence used for this resolution. */
  manifestSequence: number;
  manifestPayloadSha256: string;
  /** Kind of partial update relative to installed pair. */
  updateKind: "paired" | "grok_only" | "desk_only" | "none";
  /** Signed resolver authorized installing an older Desk version. */
  allowDeskDowngrade: boolean;
};

export type StageGrokResult =
  | { ok: true; staged: StagedArtifactRef; switched: false }
  | { ok: false; code: string; message: string };

export type StageDeskResult =
  | { ok: true; staged: StagedArtifactRef }
  | { ok: false; code: string; message: string };

export type SwitchRuntimeResult =
  | { ok: true; previous: PreviousRuntimeRef | null }
  | { ok: false; code: string; message: string };

export type InstallDeskResult =
  | { ok: true; willRestart: true }
  | { ok: false; code: string; message: string };

export type UpdateCoordinatorDeps = {
  journal: UpdateJournalStore;
  isIdle: () => boolean | Promise<boolean>;
  getInstalled: () => InstalledPairRef | Promise<InstalledPairRef>;
  getChannel: () => ReleaseChannel | Promise<ReleaseChannel>;
  getTarget: () => CanonicalRuntimeTarget | Promise<CanonicalRuntimeTarget>;
  /**
   * Resolve exactly one compatible pair. Must be pure w.r.t. sequence when
   * `expectedSequence` is provided (re-resolve guard).
   */
  resolvePair: (input: {
    installed: InstalledPairRef;
    channel: ReleaseChannel;
    target: CanonicalRuntimeTarget;
    expectedSequence?: number;
  }) => ResolvedPairSnapshot | null | Promise<ResolvedPairSnapshot | null>;
  /** Download + verify Grok into staging without switching current.json. */
  stageGrok: (pair: ResolvedPairSnapshot) => StageGrokResult | Promise<StageGrokResult>;
  /** Obtain exact-version Desk feed/grant and stage via desk updater. */
  stageDesk: (pair: ResolvedPairSnapshot) => StageDeskResult | Promise<StageDeskResult>;
  /** Switch managed runtime pointer to staged Grok (only when idle). */
  switchGrokRuntime: (
    staged: StagedArtifactRef,
  ) => SwitchRuntimeResult | Promise<SwitchRuntimeResult>;
  /** Authorize Desk install-on-restart (electron-updater quitAndInstall). */
  installDeskOnRestart: (
    staged: StagedArtifactRef,
  ) => InstallDeskResult | Promise<InstallDeskResult>;
  /** Restore previous Grok runtime after failed post-update health. */
  restorePreviousRuntime?: (
    previous: PreviousRuntimeRef,
  ) => SwitchRuntimeResult | Promise<SwitchRuntimeResult>;
  health: UpdateHealthDeps;
  now?: () => Date;
  /** Optional listener for status changes (renderer diagnostics). */
  onStatus?: (status: UpdateStatus) => void;
  /**
   * Durable trusted-time floor (Task 9). When set, security deadline /
   * revocation evaluation uses floor time instead of raw wall clock.
   */
  trustedTime?: TrustedTimeFloor;
  /**
   * Apply evaluated security policy to the gateway readiness guard.
   * Main/gateway composition only — renderer IPC must never call this path.
   */
  applySecurityPolicy?: (policy: SecurityPolicySnapshot) => void;
  /**
   * Optional previous verified Grok runtime for revocation recovery.
   * Defaults to journal `previousRuntime` when omitted.
   */
  getPreviousRuntime?: () =>
    | PreviousRuntimeRef
    | null
    | Promise<PreviousRuntimeRef | null>;
  /**
   * Active artifact/pair identifiers for revocation matching.
   * Defaults to installed desk/grok versions only.
   */
  getActiveRuntime?: () =>
    | ActiveRuntimeRef
    | Promise<ActiveRuntimeRef>;
};

/** Input for `applySignedSecurityPolicy` (signed manifest + server evidence). */
export type ApplySecurityPolicyInput = {
  securityDeadline?: string | null;
  revocations?: readonly Revocation[];
  /** Signed manifest issuedAt — raises the trusted-time floor. */
  manifestIssuedAt?: string | null;
  /** Entitlement API server time — raises the trusted-time floor. */
  entitlementServerTime?: string | null;
  /** When true (default), attempt switch to previous on active revocation. */
  recoverRevokedRuntime?: boolean;
};

export type CoordinatorResult =
  | {
      ok: true;
      phase: UpdatePhase;
      status: UpdateStatus;
      notes: string[];
      waitingForIdle?: boolean;
      willRestart?: boolean;
    }
  | {
      ok: false;
      phase: UpdatePhase;
      code: string;
      message: string;
      status: UpdateStatus;
      notes: string[];
    };

function toTargetPair(pair: ResolvedPairSnapshot): TargetPairRef {
  return {
    pairId: pair.pairId,
    deskVersion: pair.deskVersion,
    grokVersion: pair.grokVersion,
    requiredCapabilities: [...pair.capabilities],
  };
}

function classifyUpdateKind(
  installed: InstalledPairRef,
  pair: Pick<ResolvedPairSnapshot, "deskVersion" | "grokVersion">,
): ResolvedPairSnapshot["updateKind"] {
  const deskSame = installed.deskVersion === pair.deskVersion;
  const grokSame = installed.grokVersion === pair.grokVersion;
  if (deskSame && grokSame) return "none";
  if (deskSame && !grokSame) return "grok_only";
  if (!deskSame && grokSame) return "desk_only";
  return "paired";
}

/**
 * Map a ResolvedPair (shared resolver) + artifact digests into a coordinator snapshot.
 */
export function snapshotFromResolvedPair(
  pair: ResolvedPair,
  meta: {
    manifestSequence: number;
    manifestPayloadSha256: string;
    installed: InstalledPairRef;
  },
): ResolvedPairSnapshot {
  return {
    pairId: pair.pairId,
    channel: pair.channel,
    target: pair.target,
    deskVersion: pair.deskVersion,
    grokVersion: pair.grokVersion,
    deskArtifactId: pair.deskArtifactId,
    grokArtifactId: pair.grokArtifactId,
    capabilities: pair.capabilities,
    deskSha256: pair.deskArtifact.sha256,
    grokSha256: pair.grokArtifact.sha256,
    deskSizeBytes: pair.deskArtifact.sizeBytes,
    grokSizeBytes: pair.grokArtifact.sizeBytes,
    manifestSequence: meta.manifestSequence,
    manifestPayloadSha256: meta.manifestPayloadSha256,
    updateKind: classifyUpdateKind(meta.installed, pair),
    allowDeskDowngrade:
      pair.reason === "downgrade" &&
      compareSemver(pair.deskVersion, meta.installed.deskVersion) < 0,
  };
}

export class UpdateCoordinator {
  private readonly deps: UpdateCoordinatorDeps;
  private busy = false;
  /** After customer approves restart, block new work admission. */
  private admissionPaused = false;
  /** Last evaluated signed security policy (deadline / revocation). */
  private lastSecurityPolicy: SecurityPolicySnapshot | null = null;

  constructor(deps: UpdateCoordinatorDeps) {
    this.deps = deps;
  }

  isAdmissionPaused(): boolean {
    return this.admissionPaused;
  }

  setAdmissionPaused(paused: boolean): void {
    this.admissionPaused = paused;
  }

  /** Last security policy applied to gateway readiness (if any). */
  getSecurityPolicy(): SecurityPolicySnapshot | null {
    return this.lastSecurityPolicy;
  }

  /**
   * True when signed security policy blocks new Grok operations
   * (past deadline or revoked active runtime).
   */
  isSecurityBlocked(): boolean {
    return Boolean(this.lastSecurityPolicy?.blockGrokOperations);
  }

  async isIdle(): Promise<boolean> {
    return Boolean(await this.deps.isIdle());
  }

  getJournal(): UpdateJournalRecord | null {
    return this.deps.journal.load();
  }

  getStatus(): UpdateStatus {
    const j = this.deps.journal.load();
    if (!j) {
      return idleUpdateStatus({
        channel: "stable",
        target: "unsupported",
      });
    }
    const securityForced =
      this.lastSecurityPolicy?.phase === "after" ||
      this.lastSecurityPolicy?.activeRuntimeRevoked === true;
    const securityMode = this.lastSecurityPolicy?.mode;
    return {
      phase: j.phase,
      channel: j.channel,
      target: j.target,
      installed: j.installed,
      ...(j.targetPair
        ? {
            available: {
              pairId: j.targetPair.pairId,
              deskVersion: j.targetPair.deskVersion,
              grokVersion: j.targetPair.grokVersion,
              channel: j.channel,
              ...(securityForced ? { securityForced: true } : {}),
            },
          }
        : {}),
      ...(j.lastError
        ? { error: { code: j.lastError.code, message: j.lastError.message } }
        : {}),
      manifestSequence: j.manifestSequence,
      securityDeadline: this.lastSecurityPolicy?.securityDeadline ?? null,
      ...(securityMode ? { securityMode } : {}),
    };
  }

  /**
   * Evaluate signed security deadline / revocations using the trusted-time floor.
   *
   * Before deadline: warn and leave stage path available (does not block Grok).
   * After deadline: block new Grok ops via main-only `applySecurityPolicy`.
   * Active runtime revoked: switch to verified previous runtime or enter
   * read-only repair. Local read/export always remains allowed.
   *
   * Policy is pushed to the gateway only through `deps.applySecurityPolicy`
   * (composition root / host bridge) — renderer IPC must not set policy.
   */
  async applySignedSecurityPolicy(
    input: ApplySecurityPolicyInput,
  ): Promise<SecurityPolicySnapshot> {
    // Raise trusted-time floor from signed/server evidence only.
    if (this.deps.trustedTime) {
      this.deps.trustedTime.observe({
        manifestIssuedAt: input.manifestIssuedAt,
        entitlementServerTime: input.entitlementServerTime,
      });
    }

    const trustedNowMs = this.deps.trustedTime
      ? this.deps.trustedTime.nowMs()
      : (this.deps.now?.() ?? new Date()).getTime();

    const installed = await this.deps.getInstalled();
    await this.ensureSeed();

    const active: ActiveRuntimeRef = this.deps.getActiveRuntime
      ? await this.deps.getActiveRuntime()
      : {
          deskVersion: installed.deskVersion,
          grokVersion: installed.grokVersion,
        };

    const previous =
      (this.deps.getPreviousRuntime
        ? await this.deps.getPreviousRuntime()
        : null) ??
      this.getJournal()?.previousRuntime ??
      null;

    const policy = evaluateSecurityPolicy({
      trustedNowMs,
      securityDeadline: input.securityDeadline,
      revocations: input.revocations ?? [],
      active,
      previousRuntime: previous,
    });
    this.lastSecurityPolicy = policy;

    // Main-only path into gateway readiness (renderer cannot invoke this).
    this.deps.applySecurityPolicy?.(policy);

    // Revocation recovery: switch to verified previous or enter repair.
    const recover = input.recoverRevokedRuntime !== false;
    if (
      recover &&
      policy.mode === "revocation_switch" &&
      policy.recoveryCandidate
    ) {
      if (this.deps.restorePreviousRuntime) {
        const candidate: PreviousRuntimeRef = {
          version: policy.recoveryCandidate.version,
          target: policy.recoveryCandidate
            .target as PreviousRuntimeRef["target"],
          digestSha256: policy.recoveryCandidate.digestSha256,
        };
        const restored = await this.deps.restorePreviousRuntime(candidate);
        if (restored.ok) {
          // Keep blocking until a non-revoked runtime is confirmed by caller.
          try {
            this.deps.journal.transition("idle", {
              installed: {
                deskVersion: installed.deskVersion,
                grokVersion: candidate.version,
              },
              previousRuntime: restored.previous,
            });
          } catch {
            /* journal transition optional for recovery */
          }
        } else {
          try {
            this.deps.journal.transition("repair", {
              lastError: {
                code: "runtime_revoked",
                message: restored.message,
              },
            });
          } catch {
            /* best-effort */
          }
        }
      }
    } else if (policy.mode === "revocation_repair") {
      try {
        this.deps.journal.transition("repair", {
          lastError: {
            code: "runtime_revoked",
            message: policy.message,
          },
        });
      } catch {
        /* journal may already be in repair */
      }
    }

    this.emit();
    return policy;
  }

  private emit(): UpdateStatus {
    const status = this.getStatus();
    this.deps.onStatus?.(status);
    return status;
  }

  private async ensureSeed(): Promise<UpdateJournalRecord> {
    const existing = this.deps.journal.load();
    if (existing) return existing;
    const installed = await this.deps.getInstalled();
    const channel = await this.deps.getChannel();
    const target = await this.deps.getTarget();
    return this.deps.journal.write(
      this.deps.journal.createIdle({ channel, target, installed }),
    );
  }

  /**
   * Startup recovery: apply journal bookkeeping then continue as needed.
   */
  async recoverOnStartup(): Promise<CoordinatorResult> {
    if (this.busy) {
      return this.busyResult();
    }
    this.busy = true;
    const notes: string[] = ["recover_on_startup"];
    try {
      const journal = this.deps.journal.load();
      const plan = planJournalRecovery(journal);
      notes.push(`plan:${plan.action}`);
      this.deps.journal.applyRecoveryBookkeeping(plan);

      if (plan.action === "none" || plan.action === "clear_committed" || plan.action === "reset_idle") {
        await this.ensureSeed();
        return this.ok("idle", notes);
      }

      if (plan.action === "post_update_verification") {
        return await this.runPostUpdateVerification(notes);
      }

      if (plan.action === "repair") {
        return this.fail("repair_required", plan.reason, "repair", notes);
      }

      if (plan.action === "await_idle_or_install") {
        // Preserve staged; if customer already approved, try install when idle.
        if (plan.customerAction === "approve_restart") {
          this.admissionPaused = true;
          // Already hold `busy` — call body directly (no nested lock).
          return await this.tryInstallWhenIdleBody(notes);
        }
        return this.ok(plan.phase, notes);
      }

      if (plan.action === "resume_download" || plan.action === "resume_verify") {
        // Re-enter stage path without double-download when staged digests exist.
        return await this.resumeStaging(plan.targetPair, notes);
      }

      return this.ok(this.getJournal()?.phase ?? "idle", notes);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Check for an available pair and stage when newer.
   * Does not install or switch while work is active.
   */
  async checkAndStage(): Promise<CoordinatorResult> {
    if (this.busy) {
      return this.busyResult();
    }
    this.busy = true;
    const notes: string[] = ["check_and_stage"];
    try {
      await this.ensureSeed();
      const installed = await this.deps.getInstalled();
      const channel = await this.deps.getChannel();
      const target = await this.deps.getTarget();

      this.deps.journal.transition("checking", { installed, channel, target });
      this.emit();

      const pair = await this.deps.resolvePair({ installed, channel, target });
      if (!pair || pair.updateKind === "none") {
        this.deps.journal.transition("idle", {
          installed,
          targetPair: undefined,
        });
        // Clear staged noise.
        this.deps.journal.clear();
        await this.ensureSeed();
        notes.push("up_to_date");
        return this.ok("idle", notes);
      }

      // Partial update policy.
      if (pair.updateKind === "grok_only") {
        // Allowed: installed Desk remains compatible (desk version unchanged).
        notes.push("grok_only");
      } else if (pair.updateKind === "desk_only") {
        // Allowed: installed Grok remains compatible (grok version unchanged).
        notes.push("desk_only");
      } else {
        notes.push("paired");
      }

      this.deps.journal.transition("available", {
        targetPair: toTargetPair(pair),
        manifestSequence: pair.manifestSequence,
        manifestPayloadSha256: pair.manifestPayloadSha256,
        attempts: (this.getJournal()?.attempts ?? 0) + 1,
      });
      this.emit();

      return await this.stageResolvedPair(pair, notes);
    } catch (err) {
      return this.fail(
        "check_failed",
        err instanceof Error ? err.message : String(err),
        "error",
        notes,
      );
    } finally {
      this.busy = false;
    }
  }

  private async resumeStaging(
    targetPair: TargetPairRef,
    notes: string[],
  ): Promise<CoordinatorResult> {
    const installed = await this.deps.getInstalled();
    const channel = await this.deps.getChannel();
    const target = await this.deps.getTarget();
    const seq = this.getJournal()?.manifestSequence;
    const pair = await this.deps.resolvePair({
      installed,
      channel,
      target,
      expectedSequence: seq,
    });
    if (!pair || pair.pairId !== targetPair.pairId) {
      this.deps.journal.clear();
      await this.ensureSeed();
      return this.fail(
        "pair_changed",
        "manifest pair no longer matches journaled target",
        "idle",
        [...notes, "pair_changed"],
      );
    }
    return await this.stageResolvedPair(pair, notes);
  }

  private async stageResolvedPair(
    pair: ResolvedPairSnapshot,
    notes: string[],
  ): Promise<CoordinatorResult> {
    const journal = this.getJournal();
    if (!journal) {
      return this.fail("journal_absent", "journal missing", "error", notes);
    }

    this.deps.journal.transition("downloading", {
      targetPair: toTargetPair(pair),
      manifestSequence: pair.manifestSequence,
      manifestPayloadSha256: pair.manifestPayloadSha256,
    });
    this.emit();

    let stagedGrok = journal.stagedGrok;
    let stagedDesk = journal.stagedDesk;

    // Stage Grok when version changes (or missing staged).
    if (pair.updateKind === "paired" || pair.updateKind === "grok_only") {
      if (
        stagedGrok &&
        stagedGrok.version === pair.grokVersion &&
        stagedGrok.digestSha256.toLowerCase() === pair.grokSha256.toLowerCase()
      ) {
        notes.push("grok_already_staged");
      } else {
        const grok = await this.deps.stageGrok(pair);
        if (!grok.ok) {
          this.deps.journal.transition("error", {
            lastError: { code: grok.code, message: grok.message },
          });
          return this.fail(grok.code, grok.message, "error", [
            ...notes,
            "stage_grok_failed",
          ]);
        }
        if (grok.switched) {
          // Safety: stage path must never switch.
          return this.fail(
            "stage_switched",
            "stageGrok must not switch current runtime",
            "error",
            notes,
          );
        }
        stagedGrok = grok.staged;
        notes.push("grok_staged");
      }
    }

    // Stage Desk when version changes.
    if (pair.updateKind === "paired" || pair.updateKind === "desk_only") {
      if (
        stagedDesk &&
        stagedDesk.version === pair.deskVersion &&
        stagedDesk.digestSha256.toLowerCase() === pair.deskSha256.toLowerCase()
      ) {
        notes.push("desk_already_staged");
      } else {
        const desk = await this.deps.stageDesk(pair);
        if (!desk.ok) {
          this.deps.journal.transition("error", {
            lastError: { code: desk.code, message: desk.message },
            stagedGrok,
          });
          return this.fail(desk.code, desk.message, "error", [
            ...notes,
            "stage_desk_failed",
          ]);
        }
        stagedDesk = desk.staged;
        notes.push("desk_staged");
      }
    }

    this.deps.journal.transition("verifying", {
      stagedGrok,
      stagedDesk,
    });
    this.emit();

    // Re-resolve against the same manifest sequence (no sequence drift).
    const installed = await this.deps.getInstalled();
    const channel = await this.deps.getChannel();
    const target = await this.deps.getTarget();
    const again = await this.deps.resolvePair({
      installed,
      channel,
      target,
      expectedSequence: pair.manifestSequence,
    });
    if (
      !again ||
      again.pairId !== pair.pairId ||
      again.manifestSequence !== pair.manifestSequence ||
      again.manifestPayloadSha256.toLowerCase() !==
        pair.manifestPayloadSha256.toLowerCase()
    ) {
      this.deps.journal.transition("error", {
        lastError: {
          code: "sequence_drift",
          message: "manifest sequence changed during staging",
        },
        stagedGrok,
        stagedDesk,
      });
      return this.fail(
        "sequence_drift",
        "manifest sequence changed during staging",
        "error",
        [...notes, "sequence_drift"],
      );
    }
    notes.push("re_resolved");

    this.deps.journal.transition("staged", {
      stagedGrok,
      stagedDesk,
      targetPair: toTargetPair(pair),
      lastError: undefined,
    });
    this.emit();
    return this.ok("staged", notes);
  }

  /**
   * Customer approves "Update and restart". Blocks new admission and waits for idle.
   * Cancel is allowed from `staged` or `waiting_for_idle` (explicit only).
   */
  async approveRestart(action: CustomerUpdateAction = "approve_restart"): Promise<CoordinatorResult> {
    if (this.busy) {
      return this.busyResult();
    }
    this.busy = true;
    const notes: string[] = ["approve_restart"];
    try {
      const j = this.getJournal();
      if (action === "cancel") {
        if (
          j &&
          (j.phase === "staged" ||
            j.phase === "waiting_for_idle" ||
            j.phase === "available" ||
            j.phase === "downloading" ||
            j.phase === "verifying")
        ) {
          this.admissionPaused = false;
          this.deps.journal.clear();
          await this.ensureSeed();
          notes.push("cancelled");
          return this.ok("idle", notes);
        }
        return this.fail(
          "not_cancellable",
          "no cancellable staged update",
          j?.phase ?? "idle",
          notes,
        );
      }
      if (!j || j.phase !== "staged") {
        // Already waiting — re-enter install path without re-approving.
        if (j?.phase === "waiting_for_idle") {
          return await this.tryInstallWhenIdleBody(notes);
        }
        return this.fail(
          "not_staged",
          "no staged pair to install",
          j?.phase ?? "idle",
          notes,
        );
      }
      this.admissionPaused = true;
      this.deps.journal.transition("waiting_for_idle", {
        customerAction: action,
      });
      this.emit();
      return await this.tryInstallWhenIdleBody(notes);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Poll/try install once idle. Single-flight via `busy` so scheduler ticks
   * cannot race approveRestart/recover into double switch+install.
   */
  async tryInstallWhenIdle(notes: string[] = []): Promise<CoordinatorResult> {
    if (this.busy) {
      return this.busyResult(notes);
    }
    this.busy = true;
    try {
      return await this.tryInstallWhenIdleBody(notes);
    } finally {
      this.busy = false;
    }
  }

  /** Install path body — caller must already hold `busy` when nested. */
  private async tryInstallWhenIdleBody(
    notes: string[] = [],
  ): Promise<CoordinatorResult> {
    const j = this.getJournal();
    if (!j) {
      return this.fail("journal_absent", "journal missing", "error", notes);
    }
    if (j.phase !== "waiting_for_idle" && j.phase !== "staged" && j.phase !== "installing") {
      return this.ok(j.phase, [...notes, "not_ready_to_install"]);
    }

    if (!(await this.isIdle())) {
      if (j.phase !== "waiting_for_idle") {
        this.deps.journal.transition("waiting_for_idle", {
          customerAction: j.customerAction === "none" ? "approve_restart" : j.customerAction,
        });
        this.emit();
      }
      notes.push("not_idle");
      return {
        ok: true,
        phase: "waiting_for_idle",
        status: this.emit(),
        notes,
        waitingForIdle: true,
      };
    }

    return await this.installStaged(notes);
  }

  private async installStaged(notes: string[]): Promise<CoordinatorResult> {
    const j = this.getJournal();
    if (!j?.targetPair) {
      return this.fail("not_staged", "missing target pair", "error", notes);
    }

    // Double-check idle immediately before any switch/install.
    if (!(await this.isIdle())) {
      this.deps.journal.transition("waiting_for_idle");
      return {
        ok: true,
        phase: "waiting_for_idle",
        status: this.emit(),
        notes: [...notes, "not_idle_pre_install"],
        waitingForIdle: true,
      };
    }

    this.deps.journal.transition("installing", {
      customerAction: "approve_restart",
    });
    this.emit();
    notes.push("installing");

    let previous: PreviousRuntimeRef | null = j.previousRuntime ?? null;

    // Switch Grok first when staged.
    if (j.stagedGrok) {
      const sw = await this.deps.switchGrokRuntime(j.stagedGrok);
      if (!sw.ok) {
        this.deps.journal.transition("error", {
          lastError: { code: sw.code, message: sw.message },
        });
        this.admissionPaused = false;
        return this.fail(sw.code, sw.message, "error", [
          ...notes,
          "switch_grok_failed",
        ]);
      }
      previous = sw.previous;
      this.deps.journal.transition("installing", {
        previousRuntime: previous,
      });
      notes.push("grok_switched");
    }

    // Desk install (may restart the app).
    if (j.stagedDesk) {
      this.deps.journal.transition("restarting", {
        previousRuntime: previous,
      });
      this.emit();
      const desk = await this.deps.installDeskOnRestart(j.stagedDesk);
      if (!desk.ok) {
        // Attempt to restore Grok if we switched.
        if (previous && this.deps.restorePreviousRuntime) {
          await this.deps.restorePreviousRuntime(previous);
          notes.push("grok_restored_after_desk_fail");
        }
        this.deps.journal.transition("error", {
          lastError: { code: desk.code, message: desk.message },
        });
        this.admissionPaused = false;
        return this.fail(desk.code, desk.message, "error", [
          ...notes,
          "desk_install_failed",
        ]);
      }
      notes.push("desk_install_scheduled");
      return {
        ok: true,
        phase: "restarting",
        status: this.emit(),
        notes,
        willRestart: true,
      };
    }

    // Grok-only: no Desk restart — run health in-process and commit.
    return await this.runPostUpdateVerification([...notes, "grok_only_commit"]);
  }

  /**
   * Post-restart (or in-process grok-only) verification + commit.
   */
  async runPostUpdateVerification(
    notes: string[] = [],
  ): Promise<CoordinatorResult> {
    const j = this.getJournal();
    if (!j?.targetPair) {
      return this.fail(
        "missing_target",
        "cannot verify without target pair",
        "repair",
        notes,
      );
    }

    if (j.phase !== "post_update_verification") {
      this.deps.journal.transition("post_update_verification", {
        targetPair: j.targetPair,
        previousRuntime: j.previousRuntime,
      });
    }
    this.emit();
    notes.push("post_update_verification");

    const health: PostUpdateHealthResult = await verifyPostUpdateHealth(
      this.deps.health,
      {
        expected: j.targetPair,
        expectedGrokDigest: j.stagedGrok?.digestSha256,
        previousRuntime: j.previousRuntime,
        requiredCapabilities: j.targetPair.requiredCapabilities ?? [],
      },
    );

    if (!health.ok) {
      notes.push(...health.notes);
      if (health.restorePrevious && j.previousRuntime && this.deps.restorePreviousRuntime) {
        const restored = await this.deps.restorePreviousRuntime(j.previousRuntime);
        notes.push(restored.ok ? "previous_restored" : `restore_failed:${restored.code}`);
      }
      this.deps.journal.transition("repair", {
        lastError: { code: health.code, message: health.message },
      });
      this.admissionPaused = false;
      return this.fail(health.code, health.message, "repair", notes);
    }

    notes.push(...health.notes);
    this.deps.journal.transition("committed", {
      installed: {
        deskVersion: j.targetPair.deskVersion,
        grokVersion: j.targetPair.grokVersion,
      },
      lastError: undefined,
    });
    this.emit();
    // Clear journal after successful commit (active pair is the new installed).
    this.deps.journal.clear();
    this.admissionPaused = false;
    await this.ensureSeed();
    // Seed with new installed versions.
    const channel = await this.deps.getChannel();
    const target = await this.deps.getTarget();
    this.deps.journal.write(
      this.deps.journal.createIdle({
        channel,
        target,
        installed: {
          deskVersion: j.targetPair.deskVersion,
          grokVersion: j.targetPair.grokVersion,
        },
      }),
    );
    notes.push("committed");
    return this.ok("committed", notes);
  }

  private ok(phase: UpdatePhase, notes: string[]): CoordinatorResult {
    return {
      ok: true,
      phase,
      status: this.emit(),
      notes,
    };
  }

  /**
   * Contention response — must not move the durable journal to `error`
   * (that would corrupt an in-flight stage/install held by another flight).
   */
  private busyResult(notes: string[] = []): CoordinatorResult {
    const phase = this.getJournal()?.phase ?? "idle";
    return {
      ok: false,
      phase,
      code: "busy",
      message: "another update transaction is in progress",
      status: this.emit(),
      notes: [...notes, "busy"],
    };
  }

  private fail(
    code: string,
    message: string,
    phase: UpdatePhase = "error",
    notes: string[] = [],
  ): CoordinatorResult {
    const j = this.getJournal();
    if (j && j.phase !== phase && phase !== "idle") {
      try {
        this.deps.journal.transition(phase, {
          lastError: { code, message },
        });
      } catch {
        /* transition may be illegal from current phase; leave journal */
      }
    }
    return {
      ok: false,
      phase: this.getJournal()?.phase ?? phase,
      code,
      message,
      status: this.emit(),
      notes,
    };
  }
}
