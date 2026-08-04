import { describe, expect, it } from "vitest";
import {
  buildSmartRetryGoal,
  extractFailureMessage,
  shouldOfferSmartRetry,
} from "./smart-retry";

describe("smart-retry", () => {
  it("includes original goal and failure context", () => {
    const goal = buildSmartRetryGoal({
      originalGoal: "Scrape competitor pricing into a spreadsheet",
      failureMessage: "Browser tool timed out",
      attempt: 2,
    });
    expect(goal).toMatch(/attempt 2/i);
    expect(goal).toContain("Scrape competitor pricing");
    expect(goal).toContain("Browser tool timed out");
  });

  it("continues from partial progress when present", () => {
    const goal = buildSmartRetryGoal({
      originalGoal: "Write the brief",
      partialAnswer: "I drafted the audience section.",
    });
    expect(goal).toMatch(/Partial progress/i);
    expect(goal).toContain("audience section");
  });

  it("detects retry-worthy statuses and extracts errors", () => {
    expect(shouldOfferSmartRetry("failed")).toBe(true);
    expect(shouldOfferSmartRetry("done")).toBe(false);
    expect(
      extractFailureMessage({ errorMessage: "boom", status: "failed" }),
    ).toBe("boom");
    expect(extractFailureMessage({ status: "interrupted" })).toMatch(
      /interrupted/i,
    );
  });
});
