/**
 * ACP spawn argv builder (T1/T3 product path).
 *
 * `grok agent stdio` is the ACP transport; Desk still passes the same
 * sandbox / permission honesty flags as the headless adapter when the
 * probe reports support.
 */
import type { ApprovalMode, PolicySnapshot } from "./types.js";
import {
  policyToGrokArgs,
  resolveSandboxProfile,
  type GrokSandboxProfile,
  type AdvancedPermissionMode,
} from "./policy-to-grok-flags.js";
import {
  projectEffectiveProtection,
  type EffectiveProtectionSnapshot,
} from "./effective-protection.js";

export type BuildAcpSpawnArgsInput = {
  /** Workspace cwd for the agent process. */
  cwd: string;
  policy: Pick<
    PolicySnapshot,
    "approvalMode" | "workspaceRoots" | "allowShell" | "allowNetworkTools"
  >;
  supportsSandbox?: boolean;
  sandboxProfile?: GrokSandboxProfile;
  advancedPermissionMode?: AdvancedPermissionMode | string;
  isolateGrokHome?: boolean;
  executesOwnTools?: boolean;
  noAutoUpdate?: boolean;
  model?: string;
  /** Actual spawn env — isolation chip is derived from GROK_HOME when set. */
  spawnEnv?: Record<string, string | undefined>;
};

/**
 * Full argv after `grok` binary: `agent stdio` + policy flags (sandbox, etc.).
 * Pure — tests drive this entry point for ACP honesty.
 */
export function buildAcpSpawnArgs(input: BuildAcpSpawnArgsInput): string[] {
  const policy: PolicySnapshot = {
    approvalMode: input.policy.approvalMode,
    workspaceRoots: input.policy.workspaceRoots?.length
      ? [...input.policy.workspaceRoots]
      : [input.cwd],
    allowShell: input.policy.allowShell,
    allowNetworkTools: input.policy.allowNetworkTools,
  };
  const flagArgs = policyToGrokArgs({
    policy,
    primaryCwd: input.cwd,
    supportsSandbox: input.supportsSandbox,
    sandboxProfile: input.sandboxProfile,
    advancedPermissionMode: input.advancedPermissionMode,
    noAutoUpdate: input.noAutoUpdate,
    model: input.model,
  });
  // agent stdio first; policy flags (incl. --cwd) follow.
  // Drop redundant --cwd from flags if we already pass cwd to spawn options —
  // keep flags intact for honesty/diagnostics (same as headless).
  return ["agent", "stdio", ...flagArgs];
}

/** Project protection from the same ACP spawn args (T3). */
export function projectAcpProtection(
  input: BuildAcpSpawnArgsInput,
): EffectiveProtectionSnapshot {
  const spawnArgs = buildAcpSpawnArgs(input);
  const policy: PolicySnapshot = {
    approvalMode: input.policy.approvalMode,
    workspaceRoots: input.policy.workspaceRoots?.length
      ? [...input.policy.workspaceRoots]
      : [input.cwd],
    allowShell: input.policy.allowShell,
    allowNetworkTools: input.policy.allowNetworkTools,
  };
  return projectEffectiveProtection({
    policy,
    primaryCwd: input.cwd,
    supportsSandbox: input.supportsSandbox,
    sandboxProfile: input.sandboxProfile,
    advancedPermissionMode: input.advancedPermissionMode,
    isolateGrokHome: input.isolateGrokHome,
    executesOwnTools: input.executesOwnTools ?? true,
    spawnArgs,
    spawnEnv: input.spawnEnv,
  });
}

/**
 * Map EffectivePolicy-ish approval + caps into a PolicySnapshot for spawn.
 */
export function policySnapshotFromEffective(policy: {
  approvalMode: ApprovalMode;
  workspaceRoots: string[];
  capabilities?: Array<{ id: string; decision: string }>;
}): PolicySnapshot {
  const caps = policy.capabilities ?? [];
  const shell = caps.find((c) => c.id === "shell");
  const network = caps.find((c) => c.id === "network");
  return {
    approvalMode: policy.approvalMode,
    workspaceRoots: policy.workspaceRoots,
    allowShell: shell ? shell.decision !== "deny" : true,
    allowNetworkTools: network ? network.decision !== "deny" : true,
  };
}

export { resolveSandboxProfile };
