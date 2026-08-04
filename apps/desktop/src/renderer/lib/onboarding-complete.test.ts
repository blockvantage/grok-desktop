import { describe, it, expect } from "vitest";
import {
  ONBOARDING_DISMISSED_KEY,
  onboardingSettingsPayload,
  seedStarterGoal,
} from "./onboarding-complete";

describe("onboarding-complete", () => {
  it("builds settings payload", () => {
    expect(onboardingSettingsPayload("strict")).toEqual({
      onboardingCompleted: true,
      defaultApprovalMode: "strict",
    });
  });

  it("seeds starter goal when non-empty", () => {
    expect(seedStarterGoal("  hello  ")).toBe("hello");
    expect(seedStarterGoal("   ")).toBeNull();
    expect(seedStarterGoal("")).toBeNull();
  });

  it("exports dismissed storage key", () => {
    expect(ONBOARDING_DISMISSED_KEY).toBe("grokdesk.onboarding.dismissed");
  });
});
