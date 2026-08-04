import { describe, it, expect } from "vitest";
import {
  policyToGrokArgs,
  resolvePermissionMode,
  resolveSandboxProfile,
  sandboxProfileFromArgs,
  permissionModeFromArgs,
} from "./policy-to-grok-flags.js";
import type { PolicySnapshot } from "./types.js";

const basePolicy: PolicySnapshot = {
  approvalMode: "balanced",
  workspaceRoots: ["/workspace"],
  allowNetworkTools: true,
  allowShell: true,
};

describe("policyToGrokArgs", () => {
  it("always includes --cwd with primaryCwd", () => {
    const args = policyToGrokArgs({
      policy: basePolicy,
      primaryCwd: "/workspace/proj",
    });
    expect(args).toContain("--cwd");
    expect(args[args.indexOf("--cwd") + 1]).toBe("/workspace/proj");
  });

  it("autopilot includes --always-approve and bypassPermissions", () => {
    const args = policyToGrokArgs({
      policy: { ...basePolicy, approvalMode: "autopilot" },
      primaryCwd: "/ws",
    });
    expect(args).toContain("--always-approve");
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe(
      "bypassPermissions",
    );
  });

  it("strict does not include --always-approve", () => {
    const args = policyToGrokArgs({
      policy: { ...basePolicy, approvalMode: "strict" },
      primaryCwd: "/ws",
    });
    expect(args).not.toContain("--always-approve");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("default");
  });

  it("strict maps to default mode with side-effect deny rules (not plan mode)", () => {
    const args = policyToGrokArgs({
      policy: { ...basePolicy, approvalMode: "strict" },
      primaryCwd: "/ws",
    });
    expect(args).not.toContain("plan");
    const i = args.indexOf("--permission-mode");
    expect(args[i + 1]).toBe("default");
    expect(args.join(" ")).toContain("--deny Write");
    expect(args.join(" ")).toContain("--deny Edit");
    expect(args.join(" ")).toContain("--deny Bash");
  });

  it("disallows real CLI tool ids instead of provisional deny tokens", () => {
    const args = policyToGrokArgs({
      policy: {
        ...basePolicy,
        allowShell: false,
        allowNetworkTools: false,
      },
      primaryCwd: "/ws",
    });
    expect(args.join(" ")).not.toContain("--deny shell");
    expect(args.join(" ")).not.toContain("--deny network");
    const i = args.indexOf("--disallowed-tools");
    expect(args[i + 1]).toBe("run_terminal_cmd,web_search,web_fetch");
  });

  it("balanced uses default permission mode without always-approve", () => {
    const args = policyToGrokArgs({
      policy: basePolicy,
      primaryCwd: "/ws",
    });
    expect(args).not.toContain("--always-approve");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("default");
  });

  it("maps effort levels to reasoning-effort", () => {
    const fast = policyToGrokArgs({
      policy: basePolicy,
      effort: "fast",
      primaryCwd: "/ws",
    });
    expect(fast[fast.indexOf("--reasoning-effort") + 1]).toBe("low");

    const normal = policyToGrokArgs({
      policy: basePolicy,
      effort: "normal",
      primaryCwd: "/ws",
    });
    expect(normal[normal.indexOf("--reasoning-effort") + 1]).toBe("medium");

    const heavy = policyToGrokArgs({
      policy: basePolicy,
      effort: "heavy",
      primaryCwd: "/ws",
    });
    expect(heavy[heavy.indexOf("--reasoning-effort") + 1]).toBe("high");
  });

  it("maps max effort to high reasoning (CLI has no xhigh)", () => {
    const args = policyToGrokArgs({
      policy: basePolicy,
      effort: "max",
      primaryCwd: "/ws",
    });
    const i = args.indexOf("--reasoning-effort");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("high");
  });

  it("includes model when provided", () => {
    const args = policyToGrokArgs({
      policy: basePolicy,
      model: "grok-4.5",
      primaryCwd: "/ws",
    });
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("grok-4.5");
  });

  it("disallows shell tool and never always-approves when allowShell is false", () => {
    const args = policyToGrokArgs({
      policy: {
        ...basePolicy,
        approvalMode: "autopilot",
        allowShell: false,
      },
      primaryCwd: "/ws",
    });
    expect(args).not.toContain("--always-approve");
    expect(args).toContain("--disallowed-tools");
    expect(args[args.indexOf("--disallowed-tools") + 1]).toContain(
      "run_terminal_cmd",
    );
  });

  // --- T1: sandbox pass/omit ---

  it("passes --sandbox workspace when supportsSandbox and balanced", () => {
    const args = policyToGrokArgs({
      policy: basePolicy,
      primaryCwd: "/ws",
      supportsSandbox: true,
    });
    expect(args).toContain("--sandbox");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("workspace");
  });

  it("passes --sandbox read-only when supportsSandbox and strict (Careful)", () => {
    const args = policyToGrokArgs({
      policy: { ...basePolicy, approvalMode: "strict" },
      primaryCwd: "/ws",
      supportsSandbox: true,
    });
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
  });

  it("omits --sandbox when supportsSandbox is false", () => {
    const args = policyToGrokArgs({
      policy: basePolicy,
      primaryCwd: "/ws",
      supportsSandbox: false,
    });
    expect(args).not.toContain("--sandbox");
  });

  it("omits --sandbox when supportsSandbox is omitted (fail closed)", () => {
    const args = policyToGrokArgs({
      policy: basePolicy,
      primaryCwd: "/ws",
    });
    expect(args).not.toContain("--sandbox");
  });

  it("omits --sandbox when profile is off even if supported", () => {
    const args = policyToGrokArgs({
      policy: basePolicy,
      primaryCwd: "/ws",
      supportsSandbox: true,
      sandboxProfile: "off",
    });
    expect(args).not.toContain("--sandbox");
  });

  it("honors explicit sandboxProfile when supported", () => {
    const args = policyToGrokArgs({
      policy: basePolicy,
      primaryCwd: "/ws",
      supportsSandbox: true,
      sandboxProfile: "strict",
    });
    expect(args[args.indexOf("--sandbox") + 1]).toBe("strict");
  });

  // --- T2: permission mode compile + advanced ---

  it("Careful / Balanced / Autopilot produce distinct permission mappings", () => {
    const careful = resolvePermissionMode({ approvalMode: "strict" });
    const balanced = resolvePermissionMode({ approvalMode: "balanced" });
    const autopilot = resolvePermissionMode({ approvalMode: "autopilot" });

    expect(careful.denySideEffects).toBe(true);
    expect(balanced.denySideEffects).toBe(false);
    expect(autopilot.alwaysApprove).toBe(true);
    expect(autopilot.permissionMode).toBe("bypassPermissions");
    expect(balanced.permissionMode).toBe("default");
    expect(careful.permissionMode).toBe("default");

    const carefulArgs = policyToGrokArgs({
      policy: { ...basePolicy, approvalMode: "strict" },
      primaryCwd: "/ws",
    });
    const balancedArgs = policyToGrokArgs({
      policy: basePolicy,
      primaryCwd: "/ws",
    });
    const autoArgs = policyToGrokArgs({
      policy: { ...basePolicy, approvalMode: "autopilot" },
      primaryCwd: "/ws",
    });
    expect(carefulArgs.join(" ")).not.toBe(balancedArgs.join(" "));
    expect(balancedArgs.join(" ")).not.toBe(autoArgs.join(" "));
    expect(autoArgs).toContain("--always-approve");
    expect(carefulArgs.join(" ")).toContain("--deny Write");
  });

  it("advanced acceptEdits maps to --permission-mode acceptEdits", () => {
    const args = policyToGrokArgs({
      policy: basePolicy,
      primaryCwd: "/ws",
      advancedPermissionMode: "acceptEdits",
    });
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(args).not.toContain("--always-approve");
  });

  it("advanced auto maps to --permission-mode auto", () => {
    const args = policyToGrokArgs({
      policy: basePolicy,
      primaryCwd: "/ws",
      advancedPermissionMode: "auto",
    });
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("auto");
  });

  it("unknown advanced permission mode fails closed to Desk mode", () => {
    const args = policyToGrokArgs({
      policy: { ...basePolicy, approvalMode: "autopilot" },
      primaryCwd: "/ws",
      advancedPermissionMode: "dontAsk_unknown",
    });
    expect(args[args.indexOf("--permission-mode") + 1]).toBe(
      "bypassPermissions",
    );
    expect(args).toContain("--always-approve");
  });

  it("sandboxProfileFromArgs and permissionModeFromArgs read compiled argv", () => {
    const args = policyToGrokArgs({
      policy: basePolicy,
      primaryCwd: "/ws",
      supportsSandbox: true,
    });
    expect(sandboxProfileFromArgs(args)).toBe("workspace");
    expect(permissionModeFromArgs(args)).toBe("default");
  });

  it("resolveSandboxProfile returns null when unsupported", () => {
    expect(
      resolveSandboxProfile({
        approvalMode: "balanced",
        supportsSandbox: false,
      }),
    ).toBeNull();
  });
});
