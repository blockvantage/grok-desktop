/**
 * Fresh-app first launch (not in-app chat setup).
 * Full-window scenes → handoff into the main shell.
 *
 * See docs/analysis/onboarding-sota.md
 */

export type OnboardingSceneId =
  | "welcome"
  | "intent"
  | "workspace"
  | "policy"
  | "account"
  | "ready";

/** Ordered full-window scenes for first open. */
export const ONBOARDING_SCENES: OnboardingSceneId[] = [
  "welcome",
  "intent",
  "workspace",
  "policy",
  "account",
  "ready",
];

/** @deprecated use ONBOARDING_SCENES — kept for older tests */
export type OnboardingStepId = OnboardingSceneId;
export const ONBOARDING_STEPS = ONBOARDING_SCENES;

export type OnboardingIntentId =
  | "marketing"
  | "research"
  | "ops"
  | "chief-of-staff"
  | null;

export function shouldShowOnboarding(s: {
  onboardingCompleted: boolean;
}): boolean {
  return !s.onboardingCompleted;
}

export function canCompleteOnboarding(s: {
  hasWorkspaceRoot: boolean;
  hasApprovalMode: boolean;
}): boolean {
  // Folder is optional (matches Quick Chats / private Grok Desk folder).
  return s.hasApprovalMode;
}

/** Whether Continue is allowed on a launch scene. */
export function canAdvanceFromScene(
  scene: OnboardingSceneId,
  s: { hasWorkspaceRoot: boolean; hasApprovalMode: boolean },
): boolean {
  switch (scene) {
    case "workspace":
      // Skippable — private Grok Desk folder is used when empty.
      return true;
    case "ready":
      return canCompleteOnboarding(s);
    default:
      return true;
  }
}

/** @deprecated alias */
export function canAdvanceFromStep(
  step: OnboardingSceneId,
  s: { hasWorkspaceRoot: boolean; hasApprovalMode: boolean },
): boolean {
  return canAdvanceFromScene(step, s);
}

export function workspacePathParts(root: string): {
  name: string;
  parent: string;
} {
  const trimmed = root.trim().replace(/[/\\]+$/, "");
  if (!trimmed) return { name: "", parent: "" };
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return { name: trimmed, parent: "" };
  const name = parts[parts.length - 1]!;
  const parent = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  return { name, parent };
}

export function onboardingDaypart(
  hour: number,
): "morning" | "afternoon" | "evening" {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

export function migrateLegacyOnboardingDismissed(opts: {
  legacyDismissed: boolean;
  signedIn: boolean;
  hasWorkspaceRoot: boolean;
}): boolean {
  return opts.legacyDismissed && opts.signedIn && opts.hasWorkspaceRoot;
}

export function canNavigateToStep(
  targetIndex: number,
  _currentIndex: number,
): boolean {
  return targetIndex >= 0 && targetIndex < ONBOARDING_SCENES.length;
}

export function starterGoalKey(intent: OnboardingIntentId): string {
  switch (intent) {
    case "marketing":
      return "onboarding.starter.marketing";
    case "research":
      return "onboarding.starter.research";
    case "ops":
      return "onboarding.starter.ops";
    case "chief-of-staff":
      return "onboarding.starter.chief";
    default:
      return "onboarding.starter.general";
  }
}

/**
 * Starter goals must not assume a folder when none was selected.
 * Prefer activationStarterGoal when folder presence is known.
 */
export function starterGoalFallback(
  intent: OnboardingIntentId,
  opts?: { hasFolder?: boolean },
): string {
  const hasFolder = Boolean(opts?.hasFolder);
  if (!hasFolder) {
    switch (intent) {
      case "marketing":
        return "Draft a campaign brief for my next launch — messaging, channels, and next steps.";
      case "research":
        return "Help me research a topic and write a structured brief separating facts from open questions.";
      case "ops":
        return "Help me plan how to organize my project files into a clear structure.";
      case "chief-of-staff":
        return "Produce a short priority briefing: top 3 focus items, blockers, and next actions.";
      default:
        return "Help me plan my first project in this private workspace";
    }
  }
  switch (intent) {
    case "marketing":
      return "Draft a campaign brief for my next launch using files in this folder — messaging, channels, and next steps.";
    case "research":
      return "Research the main themes in this folder and write a structured brief separating facts from open questions.";
    case "ops":
      return "Organize files in this folder into a clear structure and summarize what you changed (no deletes).";
    case "chief-of-staff":
      return "Scan this workspace and produce a short priority briefing: top 3 focus items, blockers, and next actions.";
    default:
      return "Look through this folder and tell me the highest-leverage thing you can do first.";
  }
}

export function intentToRolePackId(intent: OnboardingIntentId): string | null {
  return intent;
}

export const ONBOARDING_INTENTS: Array<{
  id: Exclude<OnboardingIntentId, null> | "general";
  rolePackId: string | null;
  labelKey: string;
  hintKey: string;
}> = [
  {
    id: "marketing",
    rolePackId: "marketing",
    labelKey: "onboarding.intent.marketing",
    hintKey: "onboarding.intent.marketingHint",
  },
  {
    id: "research",
    rolePackId: "research",
    labelKey: "onboarding.intent.research",
    hintKey: "onboarding.intent.researchHint",
  },
  {
    id: "ops",
    rolePackId: "ops",
    labelKey: "onboarding.intent.ops",
    hintKey: "onboarding.intent.opsHint",
  },
  {
    id: "chief-of-staff",
    rolePackId: "chief-of-staff",
    labelKey: "onboarding.intent.chief",
    hintKey: "onboarding.intent.chiefHint",
  },
  {
    id: "general",
    rolePackId: null,
    labelKey: "onboarding.intent.general",
    hintKey: "onboarding.intent.generalHint",
  },
];
