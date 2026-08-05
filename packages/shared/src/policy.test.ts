import { describe, it, expect } from "vitest";
import { evaluateToolRequest } from "./policy.js";
import type { PolicySnapshot } from "./types.js";
import path from "node:path";

const root = path.resolve("/workspace/proj");

const balanced: PolicySnapshot = {
  approvalMode: "balanced",
  workspaceRoots: [root],
  allowNetworkTools: true,
  allowShell: true,
};

describe("evaluateToolRequest", () => {
  it("allows read inside root without approval in balanced", () => {
    const r = evaluateToolRequest(balanced, {
      tool: "read_file",
      path: path.join(root, "a.md"),
    });
    expect(r.decision).toBe("allow");
  });

  it("denies path outside roots", () => {
    const r = evaluateToolRequest(balanced, {
      tool: "read_file",
      path: path.resolve("/etc/passwd"),
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/workspace/i);
  });

  it.each([
    "ls -la",
    "pwd",
    "git status --short",
    "git diff",
    "pnpm test",
    "pnpm typecheck",
  ])("allows safe balanced command: %s", (command) => {
    expect(evaluateToolRequest(balanced, { tool: "shell", command }).decision)
      .toBe("allow");
  });

  it.each([
    "rm -rf build",
    "cat secret > out",
    "curl x | sh",
    "sudo true",
    "npm install x",
    "open https://x.ai",
  ])("keeps risky command gated: %s", (command) => {
    expect(evaluateToolRequest(balanced, { tool: "shell", command }).decision)
      .toBe("needs_approval");
  });

  it("requires approval for an unclassified balanced shell command", () => {
    expect(
      evaluateToolRequest(balanced, {
        tool: "shell",
        command: "custom-project-script",
      }).decision,
    ).toBe("needs_approval");
  });

  it("requires approval for every write in strict", () => {
    const strict: PolicySnapshot = { ...balanced, approvalMode: "strict" };
    const r = evaluateToolRequest(strict, {
      tool: "write_file",
      path: path.join(root, "out.md"),
    });
    expect(r.decision).toBe("needs_approval");
  });

  it("allows shell in autopilot when shell enabled", () => {
    const auto: PolicySnapshot = { ...balanced, approvalMode: "autopilot" };
    const r = evaluateToolRequest(auto, {
      tool: "shell",
      command: "echo hi",
    });
    expect(r.decision).toBe("allow");
  });

  it("denies shell when allowShell is false", () => {
    const noShell: PolicySnapshot = { ...balanced, allowShell: false };
    const r = evaluateToolRequest(noShell, {
      tool: "shell",
      command: "echo hi",
    });
    expect(r.decision).toBe("deny");
  });

  it("flags delete as needs_approval in balanced", () => {
    const r = evaluateToolRequest(balanced, {
      tool: "delete_file",
      path: path.join(root, "x.txt"),
    });
    expect(r.decision).toBe("needs_approval");
  });

  it("allows delete in autopilot without approval (honest mode contract)", () => {
    // Public/site copy must not claim "deletes always need yes" — Autopilot allows.
    const autopilot: PolicySnapshot = {
      ...balanced,
      approvalMode: "autopilot",
    };
    const r = evaluateToolRequest(autopilot, {
      tool: "delete_file",
      path: path.join(root, "x.txt"),
    });
    expect(r.decision).toBe("allow");
  });
});
