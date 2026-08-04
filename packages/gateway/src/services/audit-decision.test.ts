import { describe, it, expect } from "vitest";
import { normalizeAuditDecision } from "./audit-decision.js";

describe("normalizeAuditDecision", () => {
  it("keeps valid decisions", () => {
    expect(normalizeAuditDecision("allow")).toBe("allow");
    expect(normalizeAuditDecision("deny")).toBe("deny");
  });

  it("defaults invalid/missing to info", () => {
    expect(normalizeAuditDecision(undefined)).toBe("info");
    expect(normalizeAuditDecision("weird")).toBe("info");
    expect(normalizeAuditDecision(null)).toBe("info");
  });
});
