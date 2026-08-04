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
