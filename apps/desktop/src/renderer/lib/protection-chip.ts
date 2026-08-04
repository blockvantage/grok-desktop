/**
 * Protection chip projector (I3 / T3) — desktop binding.
 * Always driven from projectEffectiveProtection (same as spawn).
 */
import {
  claimsSafeWorkspace,
  projectEffectiveProtection,
  type EffectiveProtectionSnapshot,
  type ProjectProtectionInput,
} from "@grokdesk/shared";

export type ProtectionChipView = {
  snapshot: EffectiveProtectionSnapshot;
  /** Whether "Safe workspace" language is honest. */
  claimsSafe: boolean;
  /** Compact segments for the chip UI. */
  segments: EffectiveProtectionSnapshot["chipSegments"];
  summaryKey: string;
  /** Diagnostics expander: argv fragment (no secrets). */
  diagnosticsArgs: string[];
};

export function projectProtectionChip(
  input: ProjectProtectionInput,
): ProtectionChipView {
  const snapshot = projectEffectiveProtection(input);
  return {
    snapshot,
    claimsSafe: claimsSafeWorkspace(snapshot),
    segments: snapshot.chipSegments,
    summaryKey: snapshot.summaryLabelKey,
    diagnosticsArgs: snapshot.spawnArgs,
  };
}

/**
 * Build chip input from task policy + optional spawn protection step payload.
 * Prefer spawn payload when present (post-run honesty).
 */
export function protectionInputFromTask(opts: {
  policy: ProjectProtectionInput["policy"];
  supportsSandbox?: boolean;
  isolateGrokHome?: boolean;
  /** From session_meta protection step payload. */
  spawnProtection?: {
    spawnArgs?: string[];
    supportsSandbox?: boolean;
    isolateGrokHome?: boolean;
    executesOwnTools?: boolean;
  } | null;
}): ProjectProtectionInput {
  const p = opts.spawnProtection;
  return {
    policy: opts.policy,
    supportsSandbox: p?.supportsSandbox ?? opts.supportsSandbox,
    isolateGrokHome: p?.isolateGrokHome ?? opts.isolateGrokHome ?? true,
    executesOwnTools: p?.executesOwnTools ?? true,
    spawnArgs: p?.spawnArgs,
  };
}

/** Extract protection payload from a step event if present. */
export function protectionFromEvents(
  events: readonly {
    kind: string;
    payload?: Record<string, unknown> | null;
  }[],
): ProjectProtectionInput["spawnArgs"] extends infer _S
  ? {
      spawnArgs: string[];
      supportsSandbox: boolean;
      isolateGrokHome: boolean;
      executesOwnTools: boolean;
    } | null
  : never {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.kind !== "step") continue;
    const payload = ev.payload;
    if (!payload || payload.title !== "protection") continue;
    const prot = payload.protection as Record<string, unknown> | undefined;
    if (!prot || !Array.isArray(prot.spawnArgs)) continue;
    return {
      spawnArgs: prot.spawnArgs.filter((a): a is string => typeof a === "string"),
      supportsSandbox: prot.supportsSandbox === true,
      isolateGrokHome: prot.isolateGrokHome !== false,
      executesOwnTools: prot.executesOwnTools !== false,
    };
  }
  return null;
}
