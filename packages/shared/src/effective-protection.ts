/**
 * Effective protection snapshot (I3 / T3).
 *
 * Single source of truth: project from the **same** policy + probe inputs used
 * for `policyToGrokArgs`, or re-project from the actual spawn argv so the chip
 * cannot claim more than was passed.
 */

import type { ApprovalMode, PolicySnapshot } from "./types.js";
import {
  permissionModeFromArgs,
  policyToGrokArgs,
  resolveSandboxProfile,
  sandboxProfileFromArgs,
  type AdvancedPermissionMode,
  type GrokSandboxProfile,
  type PolicyToGrokArgsOptions,
} from "./policy-to-grok-flags.js";

/** Compact chip segments shown in the workspace chrome. */
export type ProtectionChipSegment =
  | "sandbox"
  | "sandbox_unavailable"
  | "approvals"
  | "network_tools"
  | "shell"
  | "isolated_profile"
  | "inherited_profile"
  | "partial_mediation";

export type EffectiveProtectionSnapshot = {
  /** Desk approval mode (Careful/Balanced/Autopilot storage values). */
  approvalMode: ApprovalMode;
  /** CLI --permission-mode value actually compiled, if any. */
  permissionMode: string | null;
  /** Whether --always-approve was compiled. */
  alwaysApprove: boolean;
  /**
   * Sandbox profile on the wire, or null when not passed.
   * When probe said unsupported, sandboxAvailable is false.
   */
  sandboxProfile: string | null;
  sandboxAvailable: boolean;
  allowShell: boolean;
  allowNetworkTools: boolean;
  /** Isolated GROK_HOME (default) vs inherit user plugins. */
  isolateGrokHome: boolean;
  /**
   * Honesty: gateway observes CLI effects; not full pre-mediation.
   * Always true for headless/ACP-own-tools paths today.
   */
  executesOwnTools: boolean;
  /** Argv fragment used for this run (diagnostics expander). */
  spawnArgs: string[];
  /** Ordered chip segments for default UI. */
  chipSegments: ProtectionChipSegment[];
  /**
   * Short product-language summary for the default chip label.
   * Never claims "Safe workspace" without a real sandbox flag.
   */
  summaryLabelKey: string;
};

export type ProjectProtectionInput = {
  policy: PolicySnapshot;
  primaryCwd?: string;
  supportsSandbox?: boolean;
  sandboxProfile?: GrokSandboxProfile;
  advancedPermissionMode?: AdvancedPermissionMode | string;
  isolateGrokHome?: boolean;
  executesOwnTools?: boolean;
  noAutoUpdate?: boolean;
  model?: string;
  effort?: PolicyToGrokArgsOptions["effort"];
  /**
   * When provided, protection is projected from actual argv (preferred for
   * post-spawn honesty). When omitted, argv is compiled via policyToGrokArgs.
   */
  spawnArgs?: readonly string[];
  /**
   * When provided, `isolateGrokHome` is derived from the actual spawn env
   * (`GROK_HOME` set and not the user's `~/.grok`), not from a claimed flag.
   */
  spawnEnv?: Record<string, string | undefined>;
};

/**
 * Isolation bit from the env that was actually passed to the CLI.
 * A claimed default is not enough — missing GROK_HOME means inherited profile.
 */
export function isolateGrokHomeFromSpawnEnv(
  env: Record<string, string | undefined>,
): boolean {
  const grokHome = env.GROK_HOME?.trim();
  if (!grokHome) return false;
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (!home) return true;
  const normalizedHome = grokHome.replace(/\\/g, "/").replace(/\/+$/, "");
  const defaultGrok = `${home.replace(/\\/g, "/").replace(/\/+$/, "")}/.grok`;
  return normalizedHome !== defaultGrok;
}

/**
 * Project effective protection from the same inputs used to spawn (or from
 * actual spawn argv). Chip and spawn cannot diverge when callers share this.
 */
export function projectEffectiveProtection(
  input: ProjectProtectionInput,
): EffectiveProtectionSnapshot {
  const isolateGrokHome = input.spawnEnv
    ? isolateGrokHomeFromSpawnEnv(input.spawnEnv)
    : input.isolateGrokHome !== false;
  const executesOwnTools = input.executesOwnTools !== false;
  const supportsSandbox = Boolean(input.supportsSandbox);

  const spawnArgs = input.spawnArgs
    ? [...input.spawnArgs]
    : policyToGrokArgs({
        policy: input.policy,
        primaryCwd: input.primaryCwd ?? input.policy.workspaceRoots[0] ?? ".",
        supportsSandbox,
        sandboxProfile: input.sandboxProfile,
        advancedPermissionMode: input.advancedPermissionMode,
        noAutoUpdate: input.noAutoUpdate,
        model: input.model,
        effort: input.effort,
      });

  const sandboxFromArgs = sandboxProfileFromArgs(spawnArgs);
  // Prefer argv truth; fall back to resolved intent only when compiling.
  const intended = resolveSandboxProfile({
    approvalMode: input.policy.approvalMode,
    supportsSandbox,
    sandboxProfile: input.sandboxProfile,
  });
  const sandboxProfile = sandboxFromArgs ?? (input.spawnArgs ? null : intended);

  const permissionMode = permissionModeFromArgs(spawnArgs);
  const alwaysApprove = spawnArgs.includes("--always-approve");

  const chipSegments: ProtectionChipSegment[] = [];
  if (sandboxProfile) {
    chipSegments.push("sandbox");
  } else if (!supportsSandbox) {
    chipSegments.push("sandbox_unavailable");
  }
  chipSegments.push("approvals");
  if (!input.policy.allowNetworkTools) chipSegments.push("network_tools");
  if (!input.policy.allowShell) chipSegments.push("shell");
  chipSegments.push(isolateGrokHome ? "isolated_profile" : "inherited_profile");
  if (executesOwnTools) chipSegments.push("partial_mediation");

  let summaryLabelKey = "protection.bestEffort";
  if (sandboxProfile && sandboxProfile !== "off") {
    summaryLabelKey =
      input.policy.approvalMode === "strict"
        ? "protection.safeWorkspaceCareful"
        : "protection.safeWorkspace";
  } else if (!supportsSandbox) {
    summaryLabelKey = "protection.cliEnforced";
  } else if (input.policy.approvalMode === "autopilot") {
    summaryLabelKey = "protection.autopilotPartial";
  }

  return {
    approvalMode: input.policy.approvalMode,
    permissionMode,
    alwaysApprove,
    sandboxProfile: sandboxProfile && sandboxProfile !== "off" ? sandboxProfile : null,
    sandboxAvailable: supportsSandbox,
    allowShell: input.policy.allowShell,
    allowNetworkTools: input.policy.allowNetworkTools,
    isolateGrokHome,
    executesOwnTools,
    spawnArgs,
    chipSegments,
    summaryLabelKey,
  };
}

/** Whether the chip may use "Safe workspace" marketing language. */
export function claimsSafeWorkspace(
  snap: EffectiveProtectionSnapshot,
): boolean {
  return Boolean(snap.sandboxProfile);
}
