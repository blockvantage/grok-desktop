/**
 * Shared Grok admission + install readiness guard (managed runtime Tasks 8–9).
 *
 * Combines:
 * - active-work idle detection (running / waiting_approval / waiting_user)
 * - update coordinator admission pause (after customer approves restart)
 * - optional entitlement capability check (desktop-entitlements lane)
 * - signed security deadline / runtime revocation policy (Task 9)
 *
 * All interactive / follow-up / retry / remote / scheduled / provider entry
 * points should call `assertGrokAdmission` before starting new Grok work.
 *
 * Security / readiness policy is main-only: call `setSecurityPolicy` from the
 * host-bridge composition root after evaluating the signed manifest. Renderer
 * IPC must never expose a channel that sets policy.
 */

/** Statuses that block install/switch and count as active work. */
export const INSTALL_BLOCKING_TASK_STATUSES = [
  "running",
  "waiting_approval",
  "waiting_user",
] as const;

export type InstallBlockingTaskStatus =
  (typeof INSTALL_BLOCKING_TASK_STATUSES)[number];

const BLOCKING_SET: ReadonlySet<string> = new Set(INSTALL_BLOCKING_TASK_STATUSES);

export function isInstallBlockingStatus(
  status: string | null | undefined,
): status is InstallBlockingTaskStatus {
  return status != null && BLOCKING_SET.has(status);
}

/** Safe capability categories (mirrors entitlement guard; no hard dependency). */
export type AdmissionCapability =
  | "grok_operation"
  | "local_read"
  | "local_manage"
  | "recovery";

/**
 * Optional entitlement boundary. Implemented by `entitlement-guard` on the
 * desktop-entitlements lane; injected here to avoid cross-branch coupling.
 */
export type EntitlementAdmission = {
  assertCapability: (
    capability: AdmissionCapability,
    action: string,
  ) => void | Promise<void>;
  checkCapability?: (
    capability: AdmissionCapability,
    action: string,
  ) =>
    | { ok: true }
    | { ok: false; code?: string; state?: string }
    | Promise<{ ok: true } | { ok: false; code?: string; state?: string }>;
};

export type TaskStatusProvider = {
  /** Return current task statuses (or full task list with status). */
  listTaskStatuses: () => readonly string[] | Promise<readonly string[]>;
};

export type UpdateAdmissionState = {
  /** True after customer approves update restart until commit/cancel. */
  isAdmissionPaused: () => boolean;
  /** Optional: coordinator idle signal (defaults to task-status idle). */
  isIdle?: () => boolean | Promise<boolean>;
  /**
   * Optional: security block from the update coordinator (past deadline or
   * revoked runtime). Prefer `setSecurityPolicy` on the guard for main-only
   * push; this pull hook is an alternate composition style.
   */
  isSecurityBlocked?: () => boolean;
};

/**
 * Signed security deadline / revocation policy applied by main only.
 * Local read/export/settings/diagnostics always remain allowed.
 */
export type SecurityAdmissionPolicy = {
  /** When true, new grok_operation is denied. */
  blockGrokOperations: boolean;
  code?:
    | "none"
    | "security_deadline"
    | "runtime_revoked"
    | "security_block"
    | string;
  message?: string;
  securityDeadline?: string | null;
  mode?: string;
};

export type OperationReadinessGuardOptions = {
  tasks: TaskStatusProvider;
  update?: UpdateAdmissionState;
  entitlement?: EntitlementAdmission | null;
  /**
   * When true (default), block new grok_operation while admission is paused
   * for an in-flight install/restart.
   */
  blockWhileAdmissionPaused?: boolean;
  /**
   * Initial security policy (tests / composition). Prefer `setSecurityPolicy`
   * after construction from the main-only path.
   */
  securityPolicy?: SecurityAdmissionPolicy | null;
};

export type IdleSnapshot = {
  idle: boolean;
  activeCount: number;
  blockingStatuses: string[];
  admissionPaused: boolean;
  evaluatedAt: string;
};

export type AdmissionCheck =
  | {
      ok: true;
      action: string;
      capability: AdmissionCapability;
      idle: boolean;
    }
  | {
      ok: false;
      code:
        | "work_active"
        | "admission_paused"
        | "entitlement_read_only"
        | "not_idle"
        | "security_deadline"
        | "runtime_revoked"
        | "security_block";
      action: string;
      capability: AdmissionCapability;
      message: string;
      idle: boolean;
      admissionPaused: boolean;
    };

export class OperationAdmissionError extends Error {
  readonly code: Exclude<AdmissionCheck, { ok: true }>["code"];
  readonly action: string;
  readonly capability: AdmissionCapability;

  constructor(check: Exclude<AdmissionCheck, { ok: true }>) {
    super(check.message);
    this.name = "OperationAdmissionError";
    this.code = check.code;
    this.action = check.action;
    this.capability = check.capability;
  }
}

export function isOperationAdmissionError(
  err: unknown,
): err is OperationAdmissionError {
  return (
    err instanceof OperationAdmissionError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: string }).name === "OperationAdmissionError")
  );
}

export type OperationReadinessGuard = {
  /** True when no install-blocking tasks are active. */
  isIdle: () => Promise<boolean>;
  getIdleSnapshot: () => Promise<IdleSnapshot>;
  /**
   * Unified Grok admission: entitlement (if configured) + admission pause +
   * signed security policy. Does not require idle for starting work — idle is
   * for install/switch. When admission is paused or security blocks, denies
   * new grok_operation. Local read/export is never blocked here.
   */
  assertGrokAdmission: (action: string) => Promise<void>;
  checkGrokAdmission: (action: string) => Promise<AdmissionCheck>;
  /**
   * Install/switch gate: requires idle and (usually) admission already paused
   * by the coordinator. Throws when work is active.
   */
  assertIdleForInstall: (action?: string) => Promise<void>;
  /** Local read/export/manage always allowed through this guard. */
  assertLocal: (
    capability: Exclude<AdmissionCapability, "grok_operation">,
    action: string,
  ) => Promise<void>;
  /**
   * Main-only: apply signed security deadline / revocation policy.
   * Renderer IPC must reject any channel that would call this.
   */
  setSecurityPolicy: (policy: SecurityAdmissionPolicy | null) => void;
  /** Current security policy (safe diagnostics; no secrets). */
  getSecurityPolicy: () => SecurityAdmissionPolicy | null;
};

export function createOperationReadinessGuard(
  options: OperationReadinessGuardOptions,
): OperationReadinessGuard {
  const blockWhilePaused = options.blockWhileAdmissionPaused !== false;
  let securityPolicy: SecurityAdmissionPolicy | null =
    options.securityPolicy ?? null;

  async function listStatuses(): Promise<string[]> {
    const raw = await options.tasks.listTaskStatuses();
    return [...raw];
  }

  async function computeIdle(): Promise<IdleSnapshot> {
    if (options.update?.isIdle) {
      const idle = Boolean(await options.update.isIdle());
      const statuses = await listStatuses();
      const blocking = statuses.filter(isInstallBlockingStatus);
      return {
        idle,
        activeCount: blocking.length,
        blockingStatuses: blocking,
        admissionPaused: Boolean(options.update?.isAdmissionPaused()),
        evaluatedAt: new Date().toISOString(),
      };
    }
    const statuses = await listStatuses();
    const blocking = statuses.filter(isInstallBlockingStatus);
    return {
      idle: blocking.length === 0,
      activeCount: blocking.length,
      blockingStatuses: blocking,
      admissionPaused: Boolean(options.update?.isAdmissionPaused()),
      evaluatedAt: new Date().toISOString(),
    };
  }

  function resolveSecurityBlock(): {
    blocked: boolean;
    code: Exclude<AdmissionCheck, { ok: true }>["code"];
    message: string;
  } | null {
    const fromUpdate = Boolean(options.update?.isSecurityBlocked?.());
    const fromPolicy = Boolean(securityPolicy?.blockGrokOperations);
    if (!fromUpdate && !fromPolicy) return null;

    const rawCode = securityPolicy?.code;
    let code: Exclude<AdmissionCheck, { ok: true }>["code"] = "security_block";
    if (rawCode === "security_deadline") code = "security_deadline";
    else if (rawCode === "runtime_revoked") code = "runtime_revoked";
    else if (rawCode === "security_block") code = "security_block";
    else if (fromUpdate && !fromPolicy) code = "security_block";

    const message =
      securityPolicy?.message ??
      (code === "security_deadline"
        ? "mandatory security update deadline has passed; new Grok operations are blocked"
        : code === "runtime_revoked"
          ? "active managed runtime is revoked; new Grok operations are blocked"
          : "security policy blocks new Grok operations");

    return { blocked: true, code, message };
  }

  async function checkGrokAdmission(action: string): Promise<AdmissionCheck> {
    const snap = await computeIdle();

    // Entitlement first when present.
    if (options.entitlement) {
      if (options.entitlement.checkCapability) {
        const ent = await options.entitlement.checkCapability(
          "grok_operation",
          action,
        );
        if (!ent.ok) {
          return {
            ok: false,
            code: "entitlement_read_only",
            action,
            capability: "grok_operation",
            message: "entitlement is read-only for this operation",
            idle: snap.idle,
            admissionPaused: snap.admissionPaused,
          };
        }
      } else {
        try {
          await options.entitlement.assertCapability("grok_operation", action);
        } catch {
          return {
            ok: false,
            code: "entitlement_read_only",
            action,
            capability: "grok_operation",
            message: "entitlement is read-only for this operation",
            idle: snap.idle,
            admissionPaused: snap.admissionPaused,
          };
        }
      }
    }

    // Signed security deadline / revocation (Task 9).
    const security = resolveSecurityBlock();
    if (security?.blocked) {
      return {
        ok: false,
        code: security.code,
        action,
        capability: "grok_operation",
        message: security.message,
        idle: snap.idle,
        admissionPaused: snap.admissionPaused,
      };
    }

    if (blockWhilePaused && snap.admissionPaused) {
      return {
        ok: false,
        code: "admission_paused",
        action,
        capability: "grok_operation",
        message:
          "new Grok work is paused while a Desk/Grok update installs or drains",
        idle: snap.idle,
        admissionPaused: true,
      };
    }

    return {
      ok: true,
      action,
      capability: "grok_operation",
      idle: snap.idle,
    };
  }

  return {
    async isIdle() {
      return (await computeIdle()).idle;
    },

    getIdleSnapshot: computeIdle,

    async checkGrokAdmission(action) {
      return checkGrokAdmission(action);
    },

    async assertGrokAdmission(action) {
      const check = await checkGrokAdmission(action);
      if (!check.ok) {
        throw new OperationAdmissionError(check);
      }
    },

    async assertIdleForInstall(action = "install") {
      const snap = await computeIdle();
      if (!snap.idle) {
        throw new OperationAdmissionError({
          ok: false,
          code: "work_active",
          action,
          capability: "local_manage",
          message: `work active (${snap.blockingStatuses.join(",")}); install deferred`,
          idle: false,
          admissionPaused: snap.admissionPaused,
        });
      }
    },

    async assertLocal(capability, action) {
      // Local read/manage/recovery intentionally bypass admission pause and
      // security deadline/revocation blocks (preserve local read/export).
      if (capability === "local_read") return;
      if (capability === "recovery") return;
      if (options.entitlement) {
        await options.entitlement.assertCapability(capability, action);
      }
    },

    setSecurityPolicy(policy) {
      // Main/gateway composition root only. No renderer path.
      securityPolicy = policy;
    },

    getSecurityPolicy() {
      return securityPolicy;
    },
  };
}

/**
 * Helper for composition roots: derive isIdle from a task list function.
 */
export function isIdleFromStatuses(
  statuses: readonly string[],
): boolean {
  return !statuses.some(isInstallBlockingStatus);
}
