/**
 * Pure helpers for onboarding completion handoff (Phase 6 extract from App).
 */

export type OnboardingCompleteOpts = {
  enableRecommended: boolean;
  starterGoal: string;
  rolePackId: string | null;
};

/**
 * Settings payload written when finishing first launch.
 */
export function onboardingSettingsPayload(
  approvalMode: "strict" | "balanced" | "autopilot",
): {
  onboardingCompleted: true;
  defaultApprovalMode: "strict" | "balanced" | "autopilot";
} {
  return {
    onboardingCompleted: true,
    defaultApprovalMode: approvalMode,
  };
}

/**
 * Seed composer goal only when non-empty after trim.
 */
export function seedStarterGoal(starterGoal: string): string | null {
  const g = starterGoal.trim();
  return g ? g : null;
}

export const ONBOARDING_DISMISSED_KEY = "grokdesk.onboarding.dismissed";
