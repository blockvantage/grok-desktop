import { describe, it, expect } from "vitest";
import {
  policyDecisionEffect,
  policyDecisionToAuditDecision,
  policyDecisionToReceiptDecision,
  toolPolicyAuditDetail,
  toolPolicyReceiptFields,
} from "./tool-policy-receipts.js";

describe("tool-policy-receipts", () => {
  it("maps policy decisions to audit/receipt enums", () => {
    expect(policyDecisionToAuditDecision("allow")).toBe("allow");
    expect(policyDecisionToAuditDecision("deny")).toBe("deny");
    expect(policyDecisionToAuditDecision("needs_approval")).toBe("info");
    expect(policyDecisionToReceiptDecision("needs_approval")).toBe("ask");
    expect(policyDecisionEffect("allow")).toBe("pending_or_provider");
    expect(policyDecisionEffect("deny")).toBeNull();
  });

  it("builds audit and receipt detail without secrets", () => {
    const event = {
      id: "tr-1",
      tool: "shell",
      command: "ls",
      path: undefined,
    };
    const decision = {
      decision: "deny" as const,
      reason: "shell denied",
    };
    expect(toolPolicyAuditDetail(event, decision)).toEqual({
      tool: "shell",
      path: undefined,
      decision: "deny",
      reason: "shell denied",
    });
    const r = toolPolicyReceiptFields(event, decision);
    expect(r.action).toBe("tool:shell");
    expect(r.decision).toBe("deny");
    expect(r.correlationId).toBe("tr-1");
    expect(r.detail).toMatchObject({ reason: "shell denied" });
  });
});
