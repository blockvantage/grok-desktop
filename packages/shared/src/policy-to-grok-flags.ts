import type { ApprovalMode, EffortLevel, PolicySnapshot } from "./types.js";
import { reasoningEffortForDesk } from "./usage-math.js";

/** CLI sandbox profiles Desk may request (T1). */
export type GrokSandboxProfile =
  | "workspace"
  | "read-only"
  | "strict"
  | "off";

/**
 * Advanced permission modes (T2) — power path only.
 * Default path uses Careful/Balanced/Autopilot via policy.approvalMode.
 */
export type AdvancedPermissionMode = "acceptEdits" | "auto";

/**
 * Options that affect spawn argv honesty (must match protection chip inputs).
 */
export type PolicyToGrokArgsOptions = {
  policy: PolicySnapshot;
  model?: string;
  effort?: EffortLevel;
  primaryCwd: string;
  /** Pass --no-auto-update when the installed CLI supports it. */
  noAutoUpdate?: boolean;
  /**
   * When true (probe.supportsSandbox), emit `--sandbox <profile>`.
   * When false/undefined, omit sandbox flags entirely (honest fail-closed).
   */
  supportsSandbox?: boolean;
  /**
   * Explicit sandbox profile. When omitted and supportsSandbox, derived from
   * approval mode: strict → read-only; balanced/autopilot → workspace.
   * Profile `off` omits the flag even when supported.
   */
  sandboxProfile?: GrokSandboxProfile;
  /**
   * Advanced permission mode override (Settings / overflow only).
   * When set and known, replaces the primary mode mapping for --permission-mode.
   * Unknown values are ignored (fail closed to Desk mode mapping).
   */
  advancedPermissionMode?: AdvancedPermissionMode | string;
  /** When true, Desk `max` effort maps to CLI `max` (else `xhigh` / `high`). */
  supportsMaxEffort?: boolean;
  supportsXhighEffort?: boolean;
};

/**
 * Resolve the sandbox profile Desk intends for a run.
 * Pure helper shared by policyToGrokArgs and the protection projector.
 */
export function resolveSandboxProfile(opts: {
  approvalMode: ApprovalMode;
  supportsSandbox?: boolean;
  sandboxProfile?: GrokSandboxProfile;
}): GrokSandboxProfile | null {
  if (!opts.supportsSandbox) return null;
  if (opts.sandboxProfile === "off") return null;
  if (
    opts.sandboxProfile === "workspace" ||
    opts.sandboxProfile === "read-only" ||
    opts.sandboxProfile === "strict"
  ) {
    return opts.sandboxProfile;
  }
  // Default: Careful research → tighter FS; daily coding → workspace.
  if (opts.approvalMode === "strict") return "read-only";
  return "workspace";
}

/**
 * Map Desk approval mode (+ optional advanced override) to a CLI permission mode.
 * Fail closed: unknown advanced values fall back to Desk mode mapping.
 */
export function resolvePermissionMode(opts: {
  approvalMode: ApprovalMode;
  advancedPermissionMode?: AdvancedPermissionMode | string;
}): {
  permissionMode: string;
  alwaysApprove: boolean;
  denySideEffects: boolean;
} {
  const advanced = opts.advancedPermissionMode;
  if (advanced === "acceptEdits") {
    return {
      permissionMode: "acceptEdits",
      alwaysApprove: false,
      denySideEffects: false,
    };
  }
  if (advanced === "auto") {
    return {
      permissionMode: "auto",
      alwaysApprove: false,
      denySideEffects: false,
    };
  }

  switch (opts.approvalMode) {
    case "autopilot":
      return {
        permissionMode: "bypassPermissions",
        alwaysApprove: true,
        denySideEffects: false,
      };
    case "strict":
      // Headless cannot prompt, so Careful = read-only research: deny side-effects.
      // ACP path replaces this with broker-mediated ask-per-request.
      return {
        permissionMode: "default",
        alwaysApprove: false,
        denySideEffects: true,
      };
    case "balanced":
    default:
      return {
        permissionMode: "default",
        alwaysApprove: false,
        denySideEffects: false,
      };
  }
}

/**
 * Convert a Desk policy snapshot (+ optional model/effort/probe) into Grok Build CLI argv.
 *
 * Honesty (SEC-01 / GROK-02 / Wave T):
 * - Sandbox is only passed when `supportsSandbox` is true (probe).
 * - Headless `strict` = read-only research mode: permission-mode default plus
 *   deny Write/Edit/Bash. ACP path replaces this with broker-mediated ask.
 * - Shell/network denials use real CLI tool ids via `--disallowed-tools`.
 * - These flags are best-effort for the headless adapter; `executesOwnTools`
 *   means the gateway observes effects, not full pre-mediation.
 *
 * Mapping (default path):
 * - autopilot → `--always-approve` + `--permission-mode bypassPermissions`
 * - balanced  → `--permission-mode default`
 * - strict    → `--permission-mode default` + deny Write/Edit/Bash (read-only)
 */
export function policyToGrokArgs(opts: PolicyToGrokArgsOptions): string[] {
  const { policy, model, effort, primaryCwd } = opts;
  const args: string[] = ["--cwd", primaryCwd];

  if (opts.noAutoUpdate) {
    args.push("--no-auto-update");
  }

  if (model) {
    args.push("--model", model);
  }

  if (effort) {
    const mapped = reasoningEffortForDesk(effort, {
      supportsMax: opts.supportsMaxEffort,
      supportsXhigh: opts.supportsXhighEffort,
    });
    if (mapped) args.push("--reasoning-effort", mapped);
  }

  const sandbox = resolveSandboxProfile({
    approvalMode: policy.approvalMode,
    supportsSandbox: opts.supportsSandbox,
    sandboxProfile: opts.sandboxProfile,
  });
  if (sandbox) {
    args.push("--sandbox", sandbox);
  }

  const perm = resolvePermissionMode({
    approvalMode: policy.approvalMode,
    advancedPermissionMode: opts.advancedPermissionMode,
  });

  // Never pass --always-approve when shell is disallowed — would override deny intent.
  if (perm.alwaysApprove && policy.allowShell) {
    args.push("--always-approve");
  }
  args.push("--permission-mode", perm.permissionMode);

  if (perm.denySideEffects) {
    args.push("--deny", "Write", "--deny", "Edit", "--deny", "Bash");
  }

  const disallowedTools: string[] = [];
  if (!policy.allowShell) disallowedTools.push("run_terminal_cmd");
  if (!policy.allowNetworkTools) disallowedTools.push("web_search", "web_fetch");
  if (disallowedTools.length) {
    args.push("--disallowed-tools", disallowedTools.join(","));
  }

  return args;
}

/**
 * Extract sandbox profile from compiled argv (for protection chip honesty).
 * Returns null when `--sandbox` is absent.
 */
export function sandboxProfileFromArgs(args: readonly string[]): string | null {
  const i = args.indexOf("--sandbox");
  if (i < 0 || i + 1 >= args.length) return null;
  const v = args[i + 1];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Extract permission-mode value from compiled argv.
 */
export function permissionModeFromArgs(args: readonly string[]): string | null {
  const i = args.indexOf("--permission-mode");
  if (i < 0 || i + 1 >= args.length) return null;
  const v = args[i + 1];
  return typeof v === "string" && v.length > 0 ? v : null;
}
