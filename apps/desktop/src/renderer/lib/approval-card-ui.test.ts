import { describe, it, expect } from "vitest";
import { projectApprovalCardView } from "./approval-card-ui";

describe("projectApprovalCardView", () => {
  it("exposes what where why for shell approval", () => {
    const v = projectApprovalCardView({
      reason: "Can change your system",
      tool: { tool: "run_terminal_cmd", command: "npm install" },
      scope: "once",
    });
    expect(v.what.length).toBeGreaterThan(0);
    expect(v.where).toBe("npm install");
    expect(v.why).toContain("system");
    expect(v.showWhere).toBe(true);
    expect(v.showScope).toBe(true);
    expect(v.scope).toBe("once");
  });

  it("hides where when absent", () => {
    const v = projectApprovalCardView({
      tool: { tool: "mystery" },
      reason: "Needs approval",
    });
    expect(v.showWhere).toBe(false);
    expect(v.why).toBe("Needs approval");
  });
});
