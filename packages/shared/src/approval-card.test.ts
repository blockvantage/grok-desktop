import { describe, it, expect } from "vitest";
import { projectApprovalCard } from "./approval-card.js";

describe("projectApprovalCard", () => {
  it("projects shell command as what/where/why", () => {
    const card = projectApprovalCard({
      reason: "Shell can change your system",
      tool: {
        tool: "run_terminal_cmd",
        command: "rm -rf /tmp/x",
      },
      scope: "once",
    });
    expect(card.what).toMatch(/terminal|run|shell|cmd/i);
    expect(card.where).toBe("rm -rf /tmp/x");
    expect(card.why).toBe("Shell can change your system");
    expect(card.scope).toBe("once");
    expect(card.effectClass).toBe("shell");
  });

  it("projects file write path", () => {
    const card = projectApprovalCard({
      tool: { name: "Write", path: "/ws/src/app.ts" },
      reason: "Writes outside the last approved edit",
    });
    expect(card.where).toBe("/ws/src/app.ts");
    expect(card.effectClass).toBe("write");
    expect(card.why).toContain("Writes");
  });

  it("projects browser URL", () => {
    const card = projectApprovalCard({
      tool: { tool: "browser_navigate", url: "https://example.com" },
      reason: "Open external site",
    });
    expect(card.where).toBe("https://example.com");
    expect(card.effectClass).toBe("browser");
  });

  it("never dumps JSON as what", () => {
    const card = projectApprovalCard({
      tool: { tool: "mystery_tool" },
    });
    expect(card.what).not.toContain("{");
    expect(card.what.length).toBeGreaterThan(0);
    expect(card.why.length).toBeGreaterThan(0);
  });

  it("parses always scope from boolean", () => {
    const card = projectApprovalCard({
      tool: { tool: "shell", command: "ls" },
      always: true,
    });
    expect(card.scope).toBe("always");
  });

  it("classifies plan review", () => {
    const card = projectApprovalCard({
      tool: { tool: "plan_review" },
      reason: "Review the plan before execution",
      what: "Plan review",
    });
    expect(card.effectClass).toBe("plan");
    expect(card.what).toBe("Plan review");
  });
});
