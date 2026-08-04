import { describe, it, expect } from "vitest";
import { policyToGrokArgs } from "../policy-to-grok-flags.js";
import { evaluateToolRequest } from "../policy.js";
import {
  claimsSafeWorkspace,
  projectEffectiveProtection,
} from "../effective-protection.js";
import type { PolicySnapshot } from "../types.js";

const base: PolicySnapshot = {
  approvalMode: "balanced",
  workspaceRoots: ["/ws"],
  allowNetworkTools: true,
  allowShell: true,
};

describe("SEC-01 / GROK-02 policy boundary characterization", () => {
  it("gateway policy denies shell when allowShell is false", () => {
    const policy: PolicySnapshot = { ...base, allowShell: false };
    const r = evaluateToolRequest(policy, { tool: "shell", command: "ls" });
    expect(r.decision).toBe("deny");
  });

  it("strict mode is read-only (deny side-effects), not plan mode", () => {
    const args = policyToGrokArgs({
      policy: { ...base, approvalMode: "strict" },
      primaryCwd: "/ws",
    });
    expect(args).not.toContain("plan");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("default");
    expect(args.join(" ")).toContain("--deny Write");
    expect(args.join(" ")).toContain("--deny Edit");
    expect(args.join(" ")).toContain("--deny Bash");
    // Must not pretend strict is full approval mediation.
    expect(args.join(" ")).not.toMatch(/ask|approval-required/i);
  });

  it("omits --sandbox when probe does not support it (honesty default)", () => {
    const args = policyToGrokArgs({
      policy: { ...base, allowShell: false, allowNetworkTools: false },
      primaryCwd: "/ws",
      supportsSandbox: false,
    });
    expect(args).not.toContain("--sandbox");
    const snap = projectEffectiveProtection({
      policy: base,
      supportsSandbox: false,
      spawnArgs: args,
    });
    expect(claimsSafeWorkspace(snap)).toBe(false);
  });

  it("passes --sandbox when probe supports it and claims match argv", () => {
    const args = policyToGrokArgs({
      policy: base,
      primaryCwd: "/ws",
      supportsSandbox: true,
    });
    expect(args).toContain("--sandbox");
    const snap = projectEffectiveProtection({
      policy: base,
      supportsSandbox: true,
      spawnArgs: args,
    });
    expect(claimsSafeWorkspace(snap)).toBe(true);
    expect(snap.sandboxProfile).toBe(args[args.indexOf("--sandbox") + 1]);
  });

  it("emits real CLI tool ids via --disallowed-tools when restricted", () => {
    const args = policyToGrokArgs({
      policy: { ...base, allowShell: false, allowNetworkTools: false },
      primaryCwd: "/ws",
    });
    expect(args).toContain("--disallowed-tools");
    expect(args[args.indexOf("--disallowed-tools") + 1]).toBe(
      "run_terminal_cmd,web_search,web_fetch",
    );
  });
});
