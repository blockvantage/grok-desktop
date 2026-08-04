import { describe, expect, it } from "vitest";
import {
  ONBOARDING_INTENTS,
  ONBOARDING_SCENES,
  canAdvanceFromScene,
  canCompleteOnboarding,
  canNavigateToStep,
  intentToRolePackId,
  migrateLegacyOnboardingDismissed,
  onboardingDaypart,
  shouldShowOnboarding,
  starterGoalFallback,
  starterGoalKey,
  workspacePathParts,
} from "./onboarding";

describe("shouldShowOnboarding", () => {
  it("shows when not completed", () => {
    expect(shouldShowOnboarding({ onboardingCompleted: false })).toBe(true);
  });

  it("hides when completed", () => {
    expect(shouldShowOnboarding({ onboardingCompleted: true })).toBe(false);
  });
});

describe("canCompleteOnboarding", () => {
  it("requires approval mode; folder is optional", () => {
    expect(
      canCompleteOnboarding({
        hasWorkspaceRoot: true,
        hasApprovalMode: true,
      }),
    ).toBe(true);
    expect(
      canCompleteOnboarding({
        hasWorkspaceRoot: false,
        hasApprovalMode: true,
      }),
    ).toBe(true);
    expect(
      canCompleteOnboarding({
        hasWorkspaceRoot: true,
        hasApprovalMode: false,
      }),
    ).toBe(false);
  });
});

describe("canAdvanceFromScene", () => {
  it("allows workspace without root (skippable folder)", () => {
    expect(
      canAdvanceFromScene("workspace", {
        hasWorkspaceRoot: false,
        hasApprovalMode: true,
      }),
    ).toBe(true);
  });

  it("allows welcome and intent freely", () => {
    const s = { hasWorkspaceRoot: false, hasApprovalMode: true };
    expect(canAdvanceFromScene("welcome", s)).toBe(true);
    expect(canAdvanceFromScene("intent", s)).toBe(true);
    expect(canAdvanceFromScene("account", s)).toBe(true);
  });
});

describe("workspacePathParts", () => {
  it("splits basename and parent", () => {
    expect(workspacePathParts("/Users/maceo/Projects/launch")).toEqual({
      name: "launch",
      parent: "Users/maceo/Projects",
    });
  });
});

describe("onboardingDaypart", () => {
  it("maps hours", () => {
    expect(onboardingDaypart(8)).toBe("morning");
    expect(onboardingDaypart(15)).toBe("afternoon");
    expect(onboardingDaypart(22)).toBe("evening");
  });
});

describe("migrateLegacyOnboardingDismissed", () => {
  it("requires full triple", () => {
    expect(
      migrateLegacyOnboardingDismissed({
        legacyDismissed: true,
        signedIn: true,
        hasWorkspaceRoot: true,
      }),
    ).toBe(true);
  });
});

describe("starter goals & intents", () => {
  it("maps intents to keys and fallbacks", () => {
    for (const intent of [
      "marketing",
      "research",
      "ops",
      "chief-of-staff",
      null,
    ] as const) {
      expect(starterGoalKey(intent).startsWith("onboarding.starter.")).toBe(
        true,
      );
      expect(starterGoalFallback(intent).length).toBeGreaterThan(20);
    }
  });

  it("intentToRolePackId identity", () => {
    expect(intentToRolePackId("ops")).toBe("ops");
    expect(intentToRolePackId(null)).toBeNull();
  });

  it("lists five intent chips", () => {
    expect(ONBOARDING_INTENTS).toHaveLength(5);
  });
});

describe("ONBOARDING_SCENES", () => {
  it("is a full-window launch sequence into the main app", () => {
    expect(ONBOARDING_SCENES).toEqual([
      "welcome",
      "intent",
      "workspace",
      "policy",
      "account",
      "ready",
    ]);
  });

  it("lets people move directly to any valid setup scene", () => {
    expect(canNavigateToStep(5, 0)).toBe(true);
    expect(canNavigateToStep(0, 5)).toBe(true);
    expect(canNavigateToStep(-1, 2)).toBe(false);
    expect(canNavigateToStep(ONBOARDING_SCENES.length, 2)).toBe(false);
  });
});
