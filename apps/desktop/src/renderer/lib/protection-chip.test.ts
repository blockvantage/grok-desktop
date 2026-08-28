import { describe, it, expect } from "vitest";
import {
  projectProtectionChip,
  protectionFromEvents,
  protectionInputFromTask,
} from "./protection-chip";
import type { PolicySnapshot } from "@grokdesk/shared";

const policy: PolicySnapshot = {
  approvalMode: "balanced",
  workspaceRoots: ["/ws"],
  allowNetworkTools: true,
  allowShell: true,
};

describe("protection chip", () => {
  it("claims Safe workspace only when sandbox in spawn args", () => {
    const withSandbox = projectProtectionChip({
      policy,
      supportsSandbox: true,
    });
    expect(withSandbox.claimsSafe).toBe(true);
    expect(withSandbox.diagnosticsArgs).toContain("--sandbox");

    const without = projectProtectionChip({
      policy,
      supportsSandbox: false,
    });
    expect(without.claimsSafe).toBe(false);
    expect(without.diagnosticsArgs).not.toContain("--sandbox");
    expect(without.summaryKey).not.toMatch(/safeWorkspace/i);
  });

  it("prefers spawn protection payload over defaults", () => {
    const input = protectionInputFromTask({
      policy,
      supportsSandbox: false,
      spawnProtection: {
        spawnArgs: ["--cwd", "/ws", "--sandbox", "workspace", "--permission-mode", "default"],
        supportsSandbox: true,
        isolateGrokHome: true,
        executesOwnTools: true,
      },
    });
    const chip = projectProtectionChip(input);
    expect(chip.claimsSafe).toBe(true);
    expect(chip.snapshot.sandboxProfile).toBe("workspace");
  });

  it("extracts protection from step events", () => {
    const found = protectionFromEvents([
      {
        kind: "step",
        payload: {
          title: "protection",
          protection: {
            spawnArgs: ["--cwd", "/ws", "--sandbox", "read-only"],
            supportsSandbox: true,
            isolateGrokHome: true,
            executesOwnTools: true,
            grokHome: "/tmp/isolated",
          },
        },
      },
    ]);
    expect(found?.spawnArgs).toContain("--sandbox");
    expect(found?.grokHome).toBe("/tmp/isolated");
    expect(protectionFromEvents([{ kind: "message", payload: {} }])).toBeNull();
  });

  it("historical snapshot wins over live Autopilot settings without sandbox argv", () => {
    const stored = protectionFromEvents([
      {
        kind: "step",
        payload: {
          title: "protection",
          protection: {
            spawnArgs: ["agent", "stdio", "--cwd", "/ws"],
            supportsSandbox: false,
            isolateGrokHome: true,
            executesOwnTools: true,
          },
        },
      },
    ]);
    const chip = projectProtectionChip(
      protectionInputFromTask({
        policy: { ...policy, approvalMode: "autopilot" },
        supportsSandbox: true,
        spawnProtection: stored,
      }),
    );
    expect(chip.claimsSafe).toBe(false);
    expect(chip.snapshot.sandboxProfile).toBeNull();
  });
});
