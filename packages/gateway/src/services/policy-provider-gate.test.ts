import { describe, it, expect } from "vitest";
import { evaluateProviderOwnToolsGate } from "./policy-provider-gate.js";

describe("evaluateProviderOwnToolsGate", () => {
  it("proceeds when provider does not execute own tools", () => {
    const r = evaluateProviderOwnToolsGate({
      executesOwnTools: false,
      allowShell: false,
      allowNetworkTools: false,
      approvalMode: "strict",
    });
    expect(r.action).toBe("proceed");
  });

  it("rejects when executesOwnTools and shell denied", () => {
    const r = evaluateProviderOwnToolsGate({
      executesOwnTools: true,
      allowShell: false,
      allowNetworkTools: true,
      approvalMode: "balanced",
    });
    expect(r).toMatchObject({
      action: "reject",
      receipt: {
        decision: "deny",
        effect: "rejected",
        detail: { reason: "uncontrolled_cannot_enforce_deny" },
      },
    });
  });

  it("rejects when network denied", () => {
    const r = evaluateProviderOwnToolsGate({
      executesOwnTools: true,
      allowShell: true,
      allowNetworkTools: false,
      approvalMode: "autopilot",
    });
    expect(r.action).toBe("reject");
  });

  it("degrades visibly under strict when shell/network still allowed", () => {
    const r = evaluateProviderOwnToolsGate({
      executesOwnTools: true,
      allowShell: true,
      allowNetworkTools: true,
      approvalMode: "strict",
    });
    expect(r.action).toBe("degraded");
    if (r.action === "degraded") {
      expect(r.stepTitle).toMatch(/plan mode ≠ ask-before-effect/i);
      expect(r.receipt.effect).toBe("degraded");
    }
  });

  it("rejects Autopilot when sandbox is required but unsupported", () => {
    const r = evaluateProviderOwnToolsGate({
      executesOwnTools: true,
      allowShell: true,
      allowNetworkTools: true,
      approvalMode: "autopilot",
      requireSandboxForAutopilot: true,
      supportsSandbox: false,
    });
    expect(r).toMatchObject({
      action: "reject",
      receipt: {
        decision: "deny",
        detail: { reason: "sandbox_required_unavailable" },
      },
    });
  });

  it("does not gate Autopilot sandbox when the requirement is off", () => {
    const r = evaluateProviderOwnToolsGate({
      executesOwnTools: true,
      allowShell: true,
      allowNetworkTools: true,
      approvalMode: "autopilot",
      requireSandboxForAutopilot: false,
      supportsSandbox: false,
    });
    expect(r.action).toBe("proceed");
  });

  it("proceeds Autopilot when sandbox is required and available", () => {
    const r = evaluateProviderOwnToolsGate({
      executesOwnTools: false,
      allowShell: true,
      allowNetworkTools: true,
      approvalMode: "autopilot",
      requireSandboxForAutopilot: true,
      supportsSandbox: true,
    });
    expect(r.action).toBe("proceed");
  });

  it("proceeds balanced when shell/network allowed", () => {
    const r = evaluateProviderOwnToolsGate({
      executesOwnTools: true,
      allowShell: true,
      allowNetworkTools: true,
      approvalMode: "balanced",
    });
    expect(r.action).toBe("proceed");
  });
});
