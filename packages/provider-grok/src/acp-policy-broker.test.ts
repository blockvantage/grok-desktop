import { describe, it, expect } from "vitest";
import {
  capabilityIdFromPermission,
  resolveAcpPermission,
  applyApproverOverride,
} from "./acp-policy-broker.js";
import type { EffectivePolicy } from "@grokdesk/agent-runtime";

const policy = (
  caps: EffectivePolicy["capabilities"],
  mode: EffectivePolicy["approvalMode"] = "balanced",
): EffectivePolicy => ({
  version: "1",
  approvalMode: mode,
  workspaceRoots: ["/w"],
  capabilities: caps,
});

describe("acp-policy-broker", () => {
  it("maps shell-like kinds to shell capability", () => {
    expect(capabilityIdFromPermission({ kind: "shell" })).toBe("shell");
    expect(
      capabilityIdFromPermission({ title: "Run bash command" }),
    ).toBe("shell");
  });

  it("denies when policy denies shell", () => {
    const r = resolveAcpPermission(
      policy([{ id: "shell", decision: "deny" }]),
      { kind: "shell", title: "ls" },
    );
    expect(r.decision).toBe("deny");
    expect(r.capabilityId).toBe("shell");
  });

  it("allows when policy allows network", () => {
    const r = resolveAcpPermission(
      policy([{ id: "network", decision: "allow" }]),
      { kind: "network" },
    );
    expect(r.decision).toBe("allow");
  });

  it("ask without approver fails closed to deny outcome", () => {
    const r = resolveAcpPermission(
      policy([{ id: "shell", decision: "ask" }]),
      { kind: "shell" },
    );
    expect(r.policyDecision).toBe("ask");
    expect(r.decision).toBe("deny");
  });

  it("strict missing capability denies", () => {
    const r = resolveAcpPermission(policy([], "strict"), { kind: "shell" });
    expect(r.decision).toBe("deny");
  });

  it("applyApproverOverride: deny policy cannot be overridden", () => {
    const broker = resolveAcpPermission(
      policy([{ id: "shell", decision: "deny" }]),
      { kind: "shell" },
    );
    expect(applyApproverOverride(broker, "allow")).toBe("deny");
  });

  it("applyApproverOverride: ask accepts human allow_once", () => {
    const broker = resolveAcpPermission(
      policy([{ id: "shell", decision: "ask" }]),
      { kind: "shell" },
    );
    expect(applyApproverOverride(broker, "allow_once")).toBe("allow_once");
    expect(applyApproverOverride(broker, null)).toBe("deny");
  });
});
