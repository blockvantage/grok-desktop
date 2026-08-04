/**
 * Durable journal for one synchronized Desk/Grok update transaction.
 *
 * Survives process restarts. Never stores grants, entitlement secrets, product
 * keys, device private keys, or download tokens — only safe pair metadata,
 * staged path digests, customer action, attempts, and timestamps.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import type {
  CanonicalRuntimeTarget,
  ReleaseChannel,
  UpdatePhase,
} from "@grokdesk/shared";
import { UpdatePhaseSchema } from "@grokdesk/shared";
import { atomicWriteFile } from "./manifest-cache.js";

export const UPDATE_JOURNAL_SCHEMA_VERSION = 1 as const;
export const UPDATE_JOURNAL_FILENAME = "update-journal.json";
export const UPDATE_JOURNAL_DIRNAME = "updates";

/** Phases that form the synchronized update state machine (excluding terminal UX). */
export const UPDATE_TRANSACTION_PHASES = [
  "idle",
  "checking",
  "available",
  "downloading",
  "verifying",
  "staged",
  "waiting_for_idle",
  "installing",
  "restarting",
  "post_update_verification",
  "committed",
] as const satisfies readonly UpdatePhase[];

export type UpdateTransactionPhase = (typeof UPDATE_TRANSACTION_PHASES)[number];

export type CustomerUpdateAction =
  | "none"
  | "approve_restart"
  | "cancel"
  | "drain";

export type InstalledPairRef = {
  deskVersion: string;
  grokVersion: string;
};

export type TargetPairRef = {
  pairId: string;
  deskVersion: string;
  grokVersion: string;
  /** Capabilities that post-update probes must observe before commit. */
  requiredCapabilities?: readonly string[];
};

/** Safe previous Grok runtime pointer retained for rollback. */
export type PreviousRuntimeRef = {
  version: string;
  target: CanonicalRuntimeTarget;
  digestSha256: string;
};

/** Staged artifact path + digest (no grant URLs or auth tokens). */
export type StagedArtifactRef = {
  kind: "desk" | "grok";
  artifactId: string;
  version: string;
  digestSha256: string;
  sizeBytes: number;
  /** Absolute path under userData (or empty when Desk is staged via updater cache). */
  path: string;
};

export type UpdateJournalError = {
  code: string;
  message: string;
};

export type UpdateJournalRecord = {
  schemaVersion: typeof UPDATE_JOURNAL_SCHEMA_VERSION;
  phase: UpdatePhase;
  channel: ReleaseChannel;
  target: CanonicalRuntimeTarget;
  installed: InstalledPairRef;
  targetPair?: TargetPairRef;
  previousRuntime?: PreviousRuntimeRef | null;
  manifestSequence?: number;
  /** SHA-256 hex of verified manifest payload bytes. */
  manifestPayloadSha256?: string;
  stagedGrok?: StagedArtifactRef;
  stagedDesk?: StagedArtifactRef;
  customerAction: CustomerUpdateAction;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: UpdateJournalError;
};

export type UpdateJournalOptions = {
  /** Electron userData directory. */
  userData: string;
  now?: () => Date;
  /** Override journal file path (tests). */
  filePath?: string;
};

/**
 * Recovery action derived from a durable journal after process restart.
 * Recovery is idempotent: re-running never double-downloads or double-installs.
 */
export type JournalRecoveryPlan =
  | {
      action: "none";
      phase: UpdatePhase;
      reason: string;
    }
  | {
      action: "reset_idle";
      phase: UpdatePhase;
      reason: string;
      preserveInstalled: true;
    }
  | {
      action: "resume_download";
      phase: UpdatePhase;
      reason: string;
      targetPair: TargetPairRef;
      stagedGrok?: StagedArtifactRef;
      stagedDesk?: StagedArtifactRef;
    }
  | {
      action: "resume_verify";
      phase: UpdatePhase;
      reason: string;
      targetPair: TargetPairRef;
      stagedGrok?: StagedArtifactRef;
      stagedDesk?: StagedArtifactRef;
    }
  | {
      action: "await_idle_or_install";
      phase: UpdatePhase;
      reason: string;
      targetPair: TargetPairRef;
      stagedGrok?: StagedArtifactRef;
      stagedDesk?: StagedArtifactRef;
      customerAction: CustomerUpdateAction;
    }
  | {
      action: "post_update_verification";
      phase: UpdatePhase;
      reason: string;
      targetPair: TargetPairRef;
      previousRuntime?: PreviousRuntimeRef | null;
    }
  | {
      action: "clear_committed";
      phase: "committed";
      reason: string;
    }
  | {
      action: "repair";
      phase: UpdatePhase;
      reason: string;
      lastError?: UpdateJournalError;
    };

const SHA256_RE = /^[a-fA-F0-9]{64}$/;
const FORBIDDEN_JOURNAL_KEYS = [
  "grant",
  "grantToken",
  "grantUrl",
  "downloadUrl",
  "productKey",
  "privateKey",
  "devicePrivateKey",
  "lease",
  "sessionToken",
  "authorization",
  "entitlementSecret",
  "pairSecret",
  "pair_secret",
  "deskToken",
  "deviceToken",
  "portalToken",
  "magicToken",
] as const;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isSha256Hex(v: unknown): v is string {
  return typeof v === "string" && SHA256_RE.test(v);
}

function parseInstalled(raw: unknown): InstalledPairRef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isNonEmptyString(o.deskVersion) || !isNonEmptyString(o.grokVersion)) {
    return null;
  }
  return { deskVersion: o.deskVersion, grokVersion: o.grokVersion };
}

function parseTargetPair(raw: unknown): TargetPairRef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(o.pairId) ||
    !isNonEmptyString(o.deskVersion) ||
    !isNonEmptyString(o.grokVersion)
  ) {
    return null;
  }
  const requiredCapabilities = o.requiredCapabilities;
  if (
    requiredCapabilities !== undefined &&
    (!Array.isArray(requiredCapabilities) ||
      !requiredCapabilities.every(isNonEmptyString))
  ) {
    return null;
  }
  return {
    pairId: o.pairId,
    deskVersion: o.deskVersion,
    grokVersion: o.grokVersion,
    ...(requiredCapabilities !== undefined
      ? { requiredCapabilities: [...requiredCapabilities] as string[] }
      : {}),
  };
}

function parsePreviousRuntime(raw: unknown): PreviousRuntimeRef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(o.version) ||
    !isNonEmptyString(o.target) ||
    !isSha256Hex(o.digestSha256)
  ) {
    return null;
  }
  return {
    version: o.version,
    target: o.target as CanonicalRuntimeTarget,
    digestSha256: o.digestSha256.toLowerCase(),
  };
}

function parseStaged(raw: unknown): StagedArtifactRef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== "desk" && o.kind !== "grok") return null;
  if (
    !isNonEmptyString(o.artifactId) ||
    !isNonEmptyString(o.version) ||
    !isSha256Hex(o.digestSha256) ||
    typeof o.sizeBytes !== "number" ||
    !Number.isFinite(o.sizeBytes) ||
    o.sizeBytes < 0 ||
    typeof o.path !== "string"
  ) {
    return null;
  }
  return {
    kind: o.kind,
    artifactId: o.artifactId,
    version: o.version,
    digestSha256: o.digestSha256.toLowerCase(),
    sizeBytes: o.sizeBytes,
    path: o.path,
  };
}

function parseCustomerAction(raw: unknown): CustomerUpdateAction {
  if (
    raw === "none" ||
    raw === "approve_restart" ||
    raw === "cancel" ||
    raw === "drain"
  ) {
    return raw;
  }
  return "none";
}

function parseError(raw: unknown): UpdateJournalError | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (!isNonEmptyString(o.code) || !isNonEmptyString(o.message)) return undefined;
  return { code: o.code, message: o.message };
}

/** Reject secret-bearing keys if present in raw JSON objects. */
export function assertNoSecretsInJournalObject(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const stack: unknown[] = [raw];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
      continue;
    }
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      for (const forbidden of FORBIDDEN_JOURNAL_KEYS) {
        if (lower === forbidden.toLowerCase() || lower.includes("privatekey")) {
          throw new Error(`journal_contains_secret_field:${k}`);
        }
      }
      if (typeof v === "object" && v !== null) stack.push(v);
    }
  }
}

export function parseUpdateJournalRecord(
  raw: unknown,
): UpdateJournalRecord | null {
  if (!raw || typeof raw !== "object") return null;
  try {
    assertNoSecretsInJournalObject(raw);
  } catch {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== UPDATE_JOURNAL_SCHEMA_VERSION) return null;
  const phaseParse = UpdatePhaseSchema.safeParse(o.phase);
  if (!phaseParse.success) return null;
  if (o.channel !== "stable" && o.channel !== "beta") return null;
  if (!isNonEmptyString(o.target)) return null;
  const installed = parseInstalled(o.installed);
  if (!installed) return null;
  if (typeof o.attempts !== "number" || !Number.isInteger(o.attempts) || o.attempts < 0) {
    return null;
  }
  if (!isNonEmptyString(o.createdAt) || !isNonEmptyString(o.updatedAt)) {
    return null;
  }

  const record: UpdateJournalRecord = {
    schemaVersion: UPDATE_JOURNAL_SCHEMA_VERSION,
    phase: phaseParse.data,
    channel: o.channel,
    target: o.target as CanonicalRuntimeTarget,
    installed,
    customerAction: parseCustomerAction(o.customerAction),
    attempts: o.attempts,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };

  const targetPair = parseTargetPair(o.targetPair);
  if (o.targetPair !== undefined && !targetPair) return null;
  if (targetPair) record.targetPair = targetPair;

  if (o.previousRuntime === null) {
    record.previousRuntime = null;
  } else if (o.previousRuntime !== undefined) {
    const prev = parsePreviousRuntime(o.previousRuntime);
    if (!prev) return null;
    record.previousRuntime = prev;
  }

  if (o.manifestSequence !== undefined) {
    if (
      typeof o.manifestSequence !== "number" ||
      !Number.isInteger(o.manifestSequence) ||
      o.manifestSequence < 0
    ) {
      return null;
    }
    record.manifestSequence = o.manifestSequence;
  }

  if (o.manifestPayloadSha256 !== undefined) {
    if (!isSha256Hex(o.manifestPayloadSha256)) return null;
    record.manifestPayloadSha256 = o.manifestPayloadSha256.toLowerCase();
  }

  if (o.stagedGrok !== undefined) {
    const staged = parseStaged(o.stagedGrok);
    if (!staged || staged.kind !== "grok") return null;
    record.stagedGrok = staged;
  }
  if (o.stagedDesk !== undefined) {
    const staged = parseStaged(o.stagedDesk);
    if (!staged || staged.kind !== "desk") return null;
    record.stagedDesk = staged;
  }

  const err = parseError(o.lastError);
  if (o.lastError !== undefined && !err) return null;
  if (err) record.lastError = err;

  return record;
}

export function updateJournalPath(userData: string): string {
  return path.join(userData, UPDATE_JOURNAL_DIRNAME, UPDATE_JOURNAL_FILENAME);
}

/**
 * Legal forward transitions for the synchronized update state machine.
 * `error` / `repair` may be entered from any non-committed phase.
 */
export function isValidPhaseTransition(
  from: UpdatePhase,
  to: UpdatePhase,
): boolean {
  if (from === to) return true;
  if (to === "error" || to === "repair") return from !== "committed";
  if (to === "idle") {
    // Cancel / commit cleanup / failed pre-install reset.
    return true;
  }
  const edges: Record<string, readonly string[]> = {
    idle: ["checking"],
    checking: ["available", "idle"],
    available: ["downloading", "idle"],
    downloading: ["verifying", "idle", "error"],
    verifying: ["staged", "idle", "error"],
    staged: ["waiting_for_idle", "installing", "idle"],
    waiting_for_idle: ["installing", "staged", "idle"],
    // Recovery may jump installing → post_update_verification after crash.
    installing: ["restarting", "post_update_verification", "error", "repair"],
    restarting: ["post_update_verification", "error", "repair"],
    post_update_verification: ["committed", "repair", "error"],
    committed: ["idle"],
    error: ["idle", "checking", "repair"],
    repair: ["idle", "checking"],
  };
  return (edges[from] ?? []).includes(to);
}

/**
 * Derive an idempotent recovery plan from the durable journal.
 * Does not mutate disk — caller applies the plan via the coordinator.
 */
export function planJournalRecovery(
  record: UpdateJournalRecord | null,
): JournalRecoveryPlan {
  if (!record) {
    return { action: "none", phase: "idle", reason: "no_journal" };
  }

  switch (record.phase) {
    case "idle":
      return { action: "none", phase: "idle", reason: "already_idle" };

    case "committed":
      return {
        action: "clear_committed",
        phase: "committed",
        reason: "commit_complete",
      };

    case "checking":
    case "available":
      return {
        action: "reset_idle",
        phase: record.phase,
        reason: "pre_stage_interrupt",
        preserveInstalled: true,
      };

    case "downloading": {
      if (!record.targetPair) {
        return {
          action: "reset_idle",
          phase: record.phase,
          reason: "missing_target_pair",
          preserveInstalled: true,
        };
      }
      return {
        action: "resume_download",
        phase: "downloading",
        reason: "resume_interrupted_download",
        targetPair: record.targetPair,
        stagedGrok: record.stagedGrok,
        stagedDesk: record.stagedDesk,
      };
    }

    case "verifying": {
      if (!record.targetPair) {
        return {
          action: "reset_idle",
          phase: record.phase,
          reason: "missing_target_pair",
          preserveInstalled: true,
        };
      }
      return {
        action: "resume_verify",
        phase: "verifying",
        reason: "resume_interrupted_verify",
        targetPair: record.targetPair,
        stagedGrok: record.stagedGrok,
        stagedDesk: record.stagedDesk,
      };
    }

    case "staged":
    case "waiting_for_idle": {
      if (!record.targetPair) {
        return {
          action: "reset_idle",
          phase: record.phase,
          reason: "missing_target_pair",
          preserveInstalled: true,
        };
      }
      return {
        action: "await_idle_or_install",
        phase: record.phase,
        reason: "preserve_staged_pair",
        targetPair: record.targetPair,
        stagedGrok: record.stagedGrok,
        stagedDesk: record.stagedDesk,
        customerAction: record.customerAction,
      };
    }

    case "installing":
    case "restarting":
    case "post_update_verification": {
      if (!record.targetPair) {
        return {
          action: "repair",
          phase: record.phase,
          reason: "install_without_pair",
          lastError: record.lastError,
        };
      }
      return {
        action: "post_update_verification",
        phase: "post_update_verification",
        reason: "resume_post_restart_health",
        targetPair: record.targetPair,
        previousRuntime: record.previousRuntime,
      };
    }

    case "error":
    case "repair":
      return {
        action: "repair",
        phase: record.phase,
        reason: "durable_error_or_repair",
        lastError: record.lastError,
      };

    default:
      return {
        action: "reset_idle",
        phase: record.phase,
        reason: "unknown_phase",
        preserveInstalled: true,
      };
  }
}

export type JournalVersionRefs = {
  /** Grok version directory names still referenced by the journal. */
  versions: string[];
  stagingPaths: string[];
};

export function journalVersionRefs(
  record: UpdateJournalRecord | null,
): JournalVersionRefs {
  if (!record) return { versions: [], stagingPaths: [] };
  const versions = new Set<string>();
  const stagingPaths: string[] = [];
  if (record.stagedGrok) {
    versions.add(record.stagedGrok.version);
    if (record.stagedGrok.path) stagingPaths.push(record.stagedGrok.path);
  }
  if (record.previousRuntime) {
    versions.add(record.previousRuntime.version);
  }
  if (record.targetPair) {
    versions.add(record.targetPair.grokVersion);
  }
  if (record.stagedDesk?.path) {
    stagingPaths.push(record.stagedDesk.path);
  }
  return { versions: [...versions], stagingPaths };
}

export class UpdateJournalStore {
  readonly filePath: string;
  private readonly now: () => Date;

  constructor(options: UpdateJournalOptions) {
    this.filePath =
      options.filePath ?? updateJournalPath(options.userData);
    this.now = options.now ?? (() => new Date());
  }

  load(): UpdateJournalRecord | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      return parseUpdateJournalRecord(raw);
    } catch {
      return null;
    }
  }

  /**
   * Create a fresh idle journal seed for a new transaction start.
   */
  createIdle(seed: {
    channel: ReleaseChannel;
    target: CanonicalRuntimeTarget;
    installed: InstalledPairRef;
  }): UpdateJournalRecord {
    const ts = this.now().toISOString();
    return {
      schemaVersion: UPDATE_JOURNAL_SCHEMA_VERSION,
      phase: "idle",
      channel: seed.channel,
      target: seed.target,
      installed: seed.installed,
      customerAction: "none",
      attempts: 0,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  /**
   * Persist a full record (validates secret-free + schema).
   */
  write(record: UpdateJournalRecord): UpdateJournalRecord {
    assertNoSecretsInJournalObject(record);
    const parsed = parseUpdateJournalRecord(record);
    if (!parsed) {
      throw new Error("invalid_update_journal_record");
    }
    const stamped: UpdateJournalRecord = {
      ...parsed,
      updatedAt: this.now().toISOString(),
    };
    const dir = path.dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    atomicWriteFile(this.filePath, `${JSON.stringify(stamped)}\n`, 0o600);
    return stamped;
  }

  /**
   * Transition phase with optional patch. Rejects illegal edges.
   * Idempotent when `to === current.phase` (stamp only).
   */
  transition(
    to: UpdatePhase,
    patch: Partial<
      Omit<UpdateJournalRecord, "schemaVersion" | "phase" | "createdAt">
    > = {},
  ): UpdateJournalRecord {
    const current = this.load();
    if (!current) {
      throw new Error("journal_absent");
    }
    if (!isValidPhaseTransition(current.phase, to)) {
      throw new Error(
        `invalid_phase_transition:${current.phase}->${to}`,
      );
    }
    const next: UpdateJournalRecord = {
      ...current,
      ...patch,
      schemaVersion: UPDATE_JOURNAL_SCHEMA_VERSION,
      phase: to,
      createdAt: current.createdAt,
      // write() stamps updatedAt
      updatedAt: current.updatedAt,
    };
    return this.write(next);
  }

  clear(): void {
    try {
      if (existsSync(this.filePath)) unlinkSync(this.filePath);
    } catch {
      /* best-effort */
    }
  }

  recoverPlan(): JournalRecoveryPlan {
    return planJournalRecovery(this.load());
  }

  /**
   * Apply a recovery plan that only mutates journal state (no downloads).
   * Returns the journal after recovery bookkeeping.
   */
  applyRecoveryBookkeeping(plan: JournalRecoveryPlan): UpdateJournalRecord | null {
    const current = this.load();
    if (!current) return null;

    switch (plan.action) {
      case "none":
        return current;
      case "clear_committed":
      case "reset_idle": {
        // Drop in-flight staged state. Active installed pair lives in runtime
        // store / app version, not in this journal — clearing is safe.
        this.clear();
        return null;
      }
      case "post_update_verification": {
        if (current.phase === "post_update_verification") {
          return current;
        }
        // installing / restarting → post_update_verification
        return this.transition("post_update_verification", {
          targetPair: plan.targetPair,
          previousRuntime: plan.previousRuntime,
          customerAction: current.customerAction,
        });
      }
      case "repair": {
        if (current.phase === "repair") return current;
        return this.transition("repair", {
          lastError: plan.lastError ?? current.lastError,
        });
      }
      case "resume_download":
      case "resume_verify":
      case "await_idle_or_install":
        // No mutation — coordinator resumes using existing staged refs.
        return current;
      default:
        return current;
    }
  }
}
