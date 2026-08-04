import { describe, it, expect } from "vitest";
import {
  claimsSafeWorkspace,
  projectEffectiveProtection,
} from "./effective-protection.js";
import { policyToGrokArgs } from "./policy-to-grok-flags.js";
import type { PolicySnapshot } from "./types.js";

const policy: PolicySnapshot = {
  approvalMode: "balanced",
  workspaceRoots: ["/ws"],
  allowNetworkTools: true,
  allowShell: true,
};

describe("projectEffectiveProtection", () => {
  it("matches spawn args when projected from the same inputs", () => {
    const spawnArgs = policyToGrokArgs({
      policy,
      primaryCwd: "/ws",
      supportsSandbox: true,
    });
    const snap = projectEffectiveProtection({
      policy,
      primaryCwd: "/ws",
      supportsSandbox: true,
    });
    expect(snap.spawnArgs).toEqual(spawnArgs);
    expect(snap.sandboxProfile).toBe("workspace");
    expect(claimsSafeWorkspace(snap)).toBe(true);
  });

  it("never claims Safe workspace when sandbox unsupported", () => {
    const snap = projectEffectiveProtection({
      policy,
      supportsSandbox: false,
    });
    expect(snap.sandboxProfile).toBeNull();
    expect(snap.sandboxAvailable).toBe(false);
    expect(claimsSafeWorkspace(snap)).toBe(false);
    expect(snap.chipSegments).toContain("sandbox_unavailable");
    expect(snap.summaryLabelKey).not.toMatch(/safeWorkspace/i);
  });

  it("prefers actual spawn argv over intended profile", () => {
    const spawnArgs = policyToGrokArgs({
      policy,
      primaryCwd: "/ws",
      supportsSandbox: true,
      sandboxProfile: "read-only",
    });
    const snap = projectEffectiveProtection({
      policy,
      supportsSandbox: true,
      // Intentionally different intent — argv wins
      sandboxProfile: "workspace",
      spawnArgs,
    });
    expect(snap.sandboxProfile).toBe("read-only");
  });

  it("includes partial_mediation when executesOwnTools", () => {
    const snap = projectEffectiveProtection({
      policy,
      supportsSandbox: true,
      executesOwnTools: true,
    });
    expect(snap.chipSegments).toContain("partial_mediation");
    expect(snap.executesOwnTools).toBe(true);
  });

  it("reflects inherited profile when isolateGrokHome is false", () => {
    const snap = projectEffectiveProtection({
      policy,
      isolateGrokHome: false,
    });
    expect(snap.chipSegments).toContain("inherited_profile");
    expect(snap.isolateGrokHome).toBe(false);
  });

  it("Careful mode summary uses careful key when sandboxed", () => {
    const snap = projectEffectiveProtection({
      policy: { ...policy, approvalMode: "strict" },
      supportsSandbox: true,
    });
    expect(snap.summaryLabelKey).toBe("protection.safeWorkspaceCareful");
  });
});
