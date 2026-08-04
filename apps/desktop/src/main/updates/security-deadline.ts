/**
 * Trusted-time floor and signed security update policy (managed runtime Task 9).
 *
 * Fully trusted offline time is impossible without OS/hardware support. This
 * module protects ordinary clock rollback by never moving a durable floor
 * backward across:
 *   - wall clock
 *   - signed manifest `issuedAt`
 *   - entitlement API server time
 *   - monotonic elapsed time since a process-local origin
 *
 * Persist only time evidence/source — never secrets, grants, or policy
 * decisions that belong in the readiness guard.
 *
 * Layout (PATH standard under Electron userData):
 *   `<userData>/updates/trusted-time.json`
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CanonicalRuntimeTarget, Revocation } from "@grokdesk/shared";
import { atomicWriteFile } from "./manifest-cache.js";
import { UPDATE_JOURNAL_DIRNAME } from "./update-journal.js";

export const TRUSTED_TIME_SCHEMA_VERSION = 1 as const;
export const TRUSTED_TIME_FILENAME = "trusted-time.json";

export type TimeEvidenceSource =
  | "wall"
  | "manifest_issued"
  | "entitlement_server"
  | "monotonic"
  | "persisted";

/** Durable time-evidence record (safe; no secrets). */
export type TrustedTimeFloorRecord = {
  schemaVersion: typeof TRUSTED_TIME_SCHEMA_VERSION;
  /** Unix ms floor — never decreases across observations or restarts. */
  floorMs: number;
  wallMs?: number;
  manifestIssuedMs?: number;
  entitlementServerMs?: number;
  /**
   * Process-local mono origin: wall ms + hrtime ns captured together so
   * elapsed monotonic time can advance the floor when the wall is frozen/rolled.
   * Re-seeded each process (not durable across restarts — floorMs is).
   */
  monoOriginWallMs?: number;
  monoOriginNs?: string;
  updatedAt: string;
  lastSources: TimeEvidenceSource[];
};

export type TrustedTimeFloorOptions = {
  /** Electron `app.getPath("userData")` (or test temp dir). */
  userData: string;
  /** Override file path (tests). */
  filePath?: string;
  /** Injectable wall clock (unix ms). */
  wallNowMs?: () => number;
  /** Injectable monotonic clock (`process.hrtime.bigint()`). */
  monoNowNs?: () => bigint;
};

export type ObserveTimeInput = {
  wallMs?: number;
  manifestIssuedAt?: string | null;
  entitlementServerTime?: string | null;
};

export type ActiveRuntimeRef = {
  deskVersion: string;
  grokVersion: string;
  deskArtifactId?: string;
  grokArtifactId?: string;
  pairId?: string;
};

export type PreviousRuntimeCandidate = {
  version: string;
  target: CanonicalRuntimeTarget | string;
  digestSha256: string;
  artifactId?: string;
};

export type SecurityDeadlinePhase = "none" | "before" | "after";

export type SecurityPolicyMode =
  | "normal"
  | "security_warn"
  | "security_block"
  | "revocation_switch"
  | "revocation_repair";

export type SecurityPolicyCode =
  | "none"
  | "security_deadline"
  | "runtime_revoked";

/**
 * Evaluated security policy applied by main to the gateway readiness guard.
 * Local read/export/settings/diagnostics/license/runtime recovery stay allowed.
 */
export type SecurityPolicySnapshot = {
  mode: SecurityPolicyMode;
  code: SecurityPolicyCode;
  /** When true, block new Grok-backed operations. */
  blockGrokOperations: boolean;
  /** Always true — local read/export must remain available. */
  localReadAllowed: true;
  /** Stage/download the security update when a deadline is set. */
  shouldStage: boolean;
  securityDeadline: string | null;
  phase: SecurityDeadlinePhase;
  trustedNowMs: number;
  activeRuntimeRevoked: boolean;
  matchingRevocations: readonly Revocation[];
  recoveryCandidate: PreviousRuntimeCandidate | null;
  message: string;
  updatedAt: string;
};

export type EvaluateSecurityPolicyInput = {
  trustedNowMs: number;
  securityDeadline?: string | null;
  revocations?: readonly Revocation[];
  active: ActiveRuntimeRef;
  previousRuntime?: PreviousRuntimeCandidate | null;
  nowIso?: () => string;
};

export function trustedTimePath(userData: string): string {
  return path.join(userData, UPDATE_JOURNAL_DIRNAME, TRUSTED_TIME_FILENAME);
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (value == null || typeof value !== "string" || value.length === 0) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isFiniteMs(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function parseRecord(raw: unknown): TrustedTimeFloorRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== TRUSTED_TIME_SCHEMA_VERSION) return null;
  if (!isFiniteMs(o.floorMs) || o.floorMs < 0) return null;
  if (typeof o.updatedAt !== "string" || o.updatedAt.length === 0) return null;
  const record: TrustedTimeFloorRecord = {
    schemaVersion: TRUSTED_TIME_SCHEMA_VERSION,
    floorMs: o.floorMs,
    updatedAt: o.updatedAt,
    lastSources: Array.isArray(o.lastSources)
      ? (o.lastSources.filter(
          (s) => typeof s === "string",
        ) as TimeEvidenceSource[])
      : [],
  };
  if (isFiniteMs(o.wallMs)) record.wallMs = o.wallMs;
  if (isFiniteMs(o.manifestIssuedMs)) {
    record.manifestIssuedMs = o.manifestIssuedMs;
  }
  if (isFiniteMs(o.entitlementServerMs)) {
    record.entitlementServerMs = o.entitlementServerMs;
  }
  // Mono origin is process-local; ignore any persisted mono fields for safety.
  return record;
}

/**
 * Durable trusted-time floor.
 *
 * `nowMs()` returns max(floor, wall, mono-elapsed-from-origin). Observations
 * of signed/server times ratchet the floor up and persist evidence only.
 */
export class TrustedTimeFloor {
  readonly filePath: string;
  private readonly wallNowMs: () => number;
  private readonly monoNowNs: () => bigint;
  private floorMs: number;
  private wallMs: number | undefined;
  private manifestIssuedMs: number | undefined;
  private entitlementServerMs: number | undefined;
  private monoOriginWallMs: number;
  private monoOriginNs: bigint;
  private lastSources: TimeEvidenceSource[] = [];
  private updatedAt: string;

  constructor(options: TrustedTimeFloorOptions) {
    this.filePath = options.filePath ?? trustedTimePath(options.userData);
    this.wallNowMs = options.wallNowMs ?? (() => Date.now());
    this.monoNowNs =
      options.monoNowNs ?? (() => process.hrtime.bigint());

    const wall = this.wallNowMs();
    this.monoOriginWallMs = wall;
    this.monoOriginNs = this.monoNowNs();
    this.floorMs = wall;
    this.wallMs = wall;
    this.updatedAt = new Date(wall).toISOString();
    this.lastSources = ["wall"];

    this.loadPersisted();
    // Re-seed mono origin against current clocks after load so elapsed is
    // measured from this process start while floorMs carries durable evidence.
    this.monoOriginWallMs = this.wallNowMs();
    this.monoOriginNs = this.monoNowNs();
    // Ensure floor is at least current wall on startup (still never decreases).
    this.ratchet(this.wallNowMs(), "wall", false);
  }

  getFloorMs(): number {
    return this.floorMs;
  }

  getRecord(): TrustedTimeFloorRecord {
    return {
      schemaVersion: TRUSTED_TIME_SCHEMA_VERSION,
      floorMs: this.floorMs,
      ...(this.wallMs !== undefined ? { wallMs: this.wallMs } : {}),
      ...(this.manifestIssuedMs !== undefined
        ? { manifestIssuedMs: this.manifestIssuedMs }
        : {}),
      ...(this.entitlementServerMs !== undefined
        ? { entitlementServerMs: this.entitlementServerMs }
        : {}),
      updatedAt: this.updatedAt,
      lastSources: [...this.lastSources],
    };
  }

  /**
   * Trusted "now": max of durable floor, current wall, and mono-elapsed.
   * Side-effect: ratchets the floor when mono/wall advance past it.
   */
  nowMs(): number {
    const wall = this.wallNowMs();
    const monoElapsedMs = this.monoElapsedMs();
    const monoBased = this.monoOriginWallMs + monoElapsedMs;
    const candidates = [this.floorMs, wall, monoBased];
    const max = Math.max(...candidates);
    if (max > this.floorMs) {
      const sources: TimeEvidenceSource[] = [];
      if (wall === max) sources.push("wall");
      if (monoBased === max) sources.push("monotonic");
      this.ratchet(max, sources[0] ?? "wall", true);
      // Keep multi-source annotation accurate.
      if (sources.length > 0) this.lastSources = sources;
    }
    return this.floorMs;
  }

  /**
   * Observe external time evidence. Only raises the floor.
   * Persists time evidence after a successful ratchet.
   */
  observe(input: ObserveTimeInput = {}): number {
    const sources: TimeEvidenceSource[] = [];
    const values: number[] = [];

    const wall =
      input.wallMs !== undefined && isFiniteMs(input.wallMs)
        ? input.wallMs
        : this.wallNowMs();
    if (isFiniteMs(wall)) {
      values.push(wall);
      sources.push("wall");
      this.wallMs = Math.max(this.wallMs ?? wall, wall);
    }

    const manifestMs = parseIsoMs(input.manifestIssuedAt ?? null);
    if (manifestMs != null) {
      values.push(manifestMs);
      sources.push("manifest_issued");
      this.manifestIssuedMs = Math.max(
        this.manifestIssuedMs ?? manifestMs,
        manifestMs,
      );
    }

    const serverMs = parseIsoMs(input.entitlementServerTime ?? null);
    if (serverMs != null) {
      values.push(serverMs);
      sources.push("entitlement_server");
      this.entitlementServerMs = Math.max(
        this.entitlementServerMs ?? serverMs,
        serverMs,
      );
    }

    const monoBased = this.monoOriginWallMs + this.monoElapsedMs();
    values.push(monoBased);
    sources.push("monotonic");

    if (values.length === 0) return this.floorMs;

    const max = Math.max(this.floorMs, ...values);
    if (max > this.floorMs) {
      this.lastSources = sources.filter((_, i) => {
        // Keep sources whose values equal max or were part of the observation.
        void i;
        return true;
      });
      // Prefer annotating only sources that actually equal the new floor.
      const contributing: TimeEvidenceSource[] = [];
      if (isFiniteMs(wall) && wall === max) contributing.push("wall");
      if (manifestMs === max) contributing.push("manifest_issued");
      if (serverMs === max) contributing.push("entitlement_server");
      if (monoBased === max) contributing.push("monotonic");
      this.lastSources =
        contributing.length > 0 ? contributing : ["wall"];
      this.floorMs = max;
      this.updatedAt = new Date(this.wallNowMs()).toISOString();
      this.persist();
    } else if (manifestMs != null || serverMs != null) {
      // Persist new evidence fields even when floor did not move.
      this.updatedAt = new Date(this.wallNowMs()).toISOString();
      this.persist();
    }
    return this.floorMs;
  }

  private monoElapsedMs(): number {
    const deltaNs = this.monoNowNs() - this.monoOriginNs;
    if (deltaNs <= 0n) return 0;
    // Convert ns → ms without exceeding Number range for realistic uptimes.
    return Number(deltaNs / 1_000_000n);
  }

  private ratchet(
    valueMs: number,
    source: TimeEvidenceSource,
    persist: boolean,
  ): void {
    if (!isFiniteMs(valueMs) || valueMs <= this.floorMs) return;
    this.floorMs = valueMs;
    this.lastSources = [source];
    this.updatedAt = new Date(this.wallNowMs()).toISOString();
    if (persist) this.persist();
  }

  private loadPersisted(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const text = readFileSync(this.filePath, "utf8");
      if (text.length > 16 * 1024) return;
      const record = parseRecord(JSON.parse(text) as unknown);
      if (!record) return;
      if (record.floorMs > this.floorMs) {
        this.floorMs = record.floorMs;
        this.lastSources = ["persisted", ...record.lastSources];
      }
      if (record.wallMs !== undefined) {
        this.wallMs = Math.max(this.wallMs ?? 0, record.wallMs);
      }
      if (record.manifestIssuedMs !== undefined) {
        this.manifestIssuedMs = Math.max(
          this.manifestIssuedMs ?? 0,
          record.manifestIssuedMs,
        );
      }
      if (record.entitlementServerMs !== undefined) {
        this.entitlementServerMs = Math.max(
          this.entitlementServerMs ?? 0,
          record.entitlementServerMs,
        );
      }
      this.updatedAt = record.updatedAt;
    } catch {
      /* corrupt → keep in-memory floor */
    }
  }

  private persist(): void {
    const record = this.getRecord();
    atomicWriteFile(this.filePath, `${JSON.stringify(record, null, 2)}\n`);
  }
}

/** True when any revocation targets the active Desk/Grok pair or artifacts. */
export function isActiveRevoked(
  revocations: readonly Revocation[],
  active: ActiveRuntimeRef,
): boolean {
  for (const r of revocations) {
    if (r.kind === "pair" && active.pairId && r.id === active.pairId) {
      return true;
    }
    if (
      r.kind === "artifact" &&
      (r.id === active.deskArtifactId || r.id === active.grokArtifactId)
    ) {
      return true;
    }
    if (
      r.kind === "version" &&
      (r.id === active.deskVersion || r.id === active.grokVersion)
    ) {
      return true;
    }
  }
  return false;
}

/** True when a previous/candidate runtime version or artifact is revoked. */
export function isRuntimeRevoked(
  revocations: readonly Revocation[],
  runtime: { version: string; artifactId?: string },
): boolean {
  for (const r of revocations) {
    if (r.kind === "version" && r.id === runtime.version) return true;
    if (
      r.kind === "artifact" &&
      runtime.artifactId &&
      r.id === runtime.artifactId
    ) {
      return true;
    }
  }
  return false;
}

function matchingRevocations(
  revocations: readonly Revocation[],
  active: ActiveRuntimeRef,
): Revocation[] {
  return revocations.filter((r) => {
    if (r.kind === "pair") return active.pairId != null && r.id === active.pairId;
    if (r.kind === "artifact") {
      return r.id === active.deskArtifactId || r.id === active.grokArtifactId;
    }
    if (r.kind === "version") {
      return r.id === active.deskVersion || r.id === active.grokVersion;
    }
    return false;
  });
}

/**
 * Evaluate signed security deadline + revocations against trusted time.
 *
 * - Before deadline: warn / download / stage (`security_warn`, not blocked)
 * - After deadline: block new Grok ops (`security_block`) while local read stays
 * - Active runtime revoked: switch to verified previous or read-only repair
 */
export function evaluateSecurityPolicy(
  input: EvaluateSecurityPolicyInput,
): SecurityPolicySnapshot {
  const revocations = input.revocations ?? [];
  const trustedNowMs = input.trustedNowMs;
  const updatedAt = (input.nowIso ?? (() => new Date().toISOString()))();
  const deadlineMs = parseIsoMs(input.securityDeadline ?? null);
  const hasDeadline = deadlineMs != null;
  const pastDeadline = hasDeadline && trustedNowMs >= deadlineMs;
  const beforeDeadline = hasDeadline && trustedNowMs < deadlineMs;

  const activeRevoked = isActiveRevoked(revocations, input.active);
  const matches = activeRevoked
    ? matchingRevocations(revocations, input.active)
    : [];

  let recoveryCandidate: PreviousRuntimeCandidate | null = null;
  if (activeRevoked && input.previousRuntime) {
    if (!isRuntimeRevoked(revocations, input.previousRuntime)) {
      recoveryCandidate = {
        version: input.previousRuntime.version,
        target: input.previousRuntime.target,
        digestSha256: input.previousRuntime.digestSha256,
        ...(input.previousRuntime.artifactId
          ? { artifactId: input.previousRuntime.artifactId }
          : {}),
      };
    }
  }

  // Revocation takes precedence over deadline-only modes.
  if (activeRevoked) {
    if (recoveryCandidate) {
      return {
        mode: "revocation_switch",
        code: "runtime_revoked",
        blockGrokOperations: true,
        localReadAllowed: true,
        shouldStage: true,
        securityDeadline: input.securityDeadline ?? null,
        phase: pastDeadline ? "after" : beforeDeadline ? "before" : "none",
        trustedNowMs,
        activeRuntimeRevoked: true,
        matchingRevocations: matches,
        recoveryCandidate,
        message:
          "Active managed runtime is revoked; switch to a verified previous runtime",
        updatedAt,
      };
    }
    return {
      mode: "revocation_repair",
      code: "runtime_revoked",
      blockGrokOperations: true,
      localReadAllowed: true,
      shouldStage: true,
      securityDeadline: input.securityDeadline ?? null,
      phase: pastDeadline ? "after" : beforeDeadline ? "before" : "none",
      trustedNowMs,
      activeRuntimeRevoked: true,
      matchingRevocations: matches,
      recoveryCandidate: null,
      message:
        "Active managed runtime is revoked and no compatible previous runtime is available; read-only repair",
      updatedAt,
    };
  }

  if (pastDeadline) {
    return {
      mode: "security_block",
      code: "security_deadline",
      blockGrokOperations: true,
      localReadAllowed: true,
      shouldStage: true,
      securityDeadline: input.securityDeadline ?? null,
      phase: "after",
      trustedNowMs,
      activeRuntimeRevoked: false,
      matchingRevocations: [],
      recoveryCandidate: null,
      message:
        "Mandatory security update deadline has passed; new Grok operations are blocked until update",
      updatedAt,
    };
  }

  if (beforeDeadline) {
    return {
      mode: "security_warn",
      code: "none",
      blockGrokOperations: false,
      localReadAllowed: true,
      shouldStage: true,
      securityDeadline: input.securityDeadline ?? null,
      phase: "before",
      trustedNowMs,
      activeRuntimeRevoked: false,
      matchingRevocations: [],
      recoveryCandidate: null,
      message:
        "A mandatory security update is available; download and stage before the deadline",
      updatedAt,
    };
  }

  return {
    mode: "normal",
    code: "none",
    blockGrokOperations: false,
    localReadAllowed: true,
    shouldStage: false,
    securityDeadline: input.securityDeadline ?? null,
    phase: "none",
    trustedNowMs,
    activeRuntimeRevoked: false,
    matchingRevocations: [],
    recoveryCandidate: null,
    message: "No security deadline or active revocation",
    updatedAt,
  };
}

/**
 * Convert a policy snapshot into the narrow admission view used by the gateway.
 * Renderer IPC must never construct or set this — main composition only.
 */
export function toSecurityAdmissionPolicy(
  snapshot: SecurityPolicySnapshot,
): {
  blockGrokOperations: boolean;
  code: SecurityPolicyCode;
  message: string;
  securityDeadline: string | null;
  mode: SecurityPolicyMode;
} {
  return {
    blockGrokOperations: snapshot.blockGrokOperations,
    code: snapshot.code,
    message: snapshot.message,
    securityDeadline: snapshot.securityDeadline,
    mode: snapshot.mode,
  };
}
