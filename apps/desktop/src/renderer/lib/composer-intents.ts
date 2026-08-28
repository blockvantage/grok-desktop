/**
 * Phase 3: plain-language composer intents (non-slash workflows).
 *
 * Selecting an intent sets structured mode state (chip), not textarea scaffolding.
 * On send, expandIntentGoal produces the same auditable goal as the matching slash
 * template (where one exists). Hidden defaults (effort, role pack, plan-first,
 * workspace hints) apply without requiring the user to understand them.
 */

import type { EffortLevel } from "@grokdesk/shared";
import {
  expandSlashGoal,
  type ExpandedGoal,
  type SlashCommand,
  SLASH_COMMANDS,
} from "./composer-input";

/** Phase 3 workflows users can start without slash syntax. */
export type ComposerIntentId =
  | "brief"
  | "research"
  | "image"
  | "video"
  | "organize"
  | "schedule"
  | "summarize";

export type ComposerIntentDef = {
  id: ComposerIntentId;
  /** i18n key for chip / button label */
  labelKey: string;
  /** i18n key for short description (chip effect / tooltip) */
  descKey: string;
  /** i18n key for expanded goal template (send-time) */
  goalKey: string;
  /**
   * Matching slash token when the same template is also a fill command.
   * Used for intent↔slash payload equivalence.
   */
  slashToken?: string;
  /** Lucide-style icon key for Home chips */
  icon: "pen" | "search" | "image" | "video" | "folder" | "calendar" | "sparkles";
  /** Auto-apply effort when arming (restored on clear if user did not override). */
  effort?: EffortLevel;
  /** Preferred role pack id when user has no explicit pack. */
  preferRolePack?: string;
  /** Turn on plan-first when arming. */
  planFirst?: boolean;
  /** Prefer when a workspace folder is set; may prompt pick folder. */
  needsWorkspace?: boolean;
  /**
   * Non-create side effect on send: open schedule surface with expanded goal
   * as the schedule draft (user still confirms create).
   */
  sendAction?: "create_task" | "open_schedule";
};

export const COMPOSER_INTENT_CATALOG: ComposerIntentDef[] = [
  {
    id: "brief",
    labelKey: "intent.brief",
    descKey: "intent.briefDesc",
    goalKey: "slash.briefGoal",
    slashToken: "brief",
    icon: "pen",
    preferRolePack: "marketing",
    sendAction: "create_task",
  },
  {
    id: "research",
    labelKey: "intent.research",
    descKey: "intent.researchDesc",
    goalKey: "slash.researchGoal",
    slashToken: "research",
    icon: "search",
    effort: "heavy",
    preferRolePack: "research",
    planFirst: true,
    sendAction: "create_task",
  },
  {
    id: "image",
    labelKey: "intent.image",
    descKey: "intent.imageDesc",
    goalKey: "slash.imageGoal",
    slashToken: "image",
    icon: "image",
    preferRolePack: "marketing",
    sendAction: "create_task",
  },
  {
    id: "video",
    labelKey: "intent.video",
    descKey: "intent.videoDesc",
    goalKey: "slash.videoGoal",
    slashToken: "video",
    icon: "video",
    preferRolePack: "marketing",
    sendAction: "create_task",
  },
  {
    id: "organize",
    labelKey: "intent.organize",
    descKey: "intent.organizeDesc",
    goalKey: "slash.organizeGoal",
    slashToken: "organize",
    icon: "folder",
    preferRolePack: "ops",
    needsWorkspace: true,
    sendAction: "create_task",
  },
  {
    id: "schedule",
    labelKey: "intent.schedule",
    descKey: "intent.scheduleDesc",
    goalKey: "intent.scheduleGoal",
    // Slash /schedule is an action (open schedules), not a fill template.
    icon: "calendar",
    preferRolePack: "chief-of-staff",
    sendAction: "open_schedule",
  },
  {
    id: "summarize",
    labelKey: "intent.summarize",
    descKey: "intent.summarizeDesc",
    goalKey: "intent.summarizeGoal",
    icon: "sparkles",
    preferRolePack: "chief-of-staff",
    planFirst: false,
    needsWorkspace: true,
    sendAction: "create_task",
  },
];

export function findComposerIntent(
  id: ComposerIntentId | string | null | undefined,
): ComposerIntentDef | null {
  if (!id) return null;
  return COMPOSER_INTENT_CATALOG.find((d) => d.id === id) ?? null;
}

/**
 * Rank intents for Home chips: pack affinity + workspace, cap at limit.
 * Always returns up to `limit` intents so the surface is discoverable when calm.
 */
export function pickComposerIntents(
  ctx: {
    rolePackId: string | null;
    hasWorkspace: boolean;
  },
  limit = 6,
): ComposerIntentDef[] {
  return [...COMPOSER_INTENT_CATALOG]
    .map((def) => {
      let score = 0;
      if (
        def.preferRolePack &&
        ctx.rolePackId &&
        def.preferRolePack === ctx.rolePackId
      ) {
        score += 10;
      }
      if (def.needsWorkspace) {
        score += ctx.hasWorkspace ? 4 : -2;
      }
      // Stable catalog order for ties.
      score +=
        COMPOSER_INTENT_CATALOG.findIndex((d) => d.id === def.id) * -0.01;
      return { def, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.def);
}

/**
 * Weave user args into an intent goal template (same shape as weaveSlashArgs).
 */
export function weaveIntentArgs(
  template: string,
  args: string,
  topicLine: string,
): string {
  const a = args.trim();
  if (!a) return template;
  return `${template}\n\n${topicLine}`;
}

export type ExpandedIntentGoal = {
  goal: string;
  intent: ComposerIntentDef;
  /** Compact source for goalSource audit (not slash syntax). */
  source: string;
  sendAction: "create_task" | "open_schedule";
};

/**
 * Expand active intent + user textarea into auditable goal at send time.
 * User text stays free-form (no scaffolding dumped into the box).
 */
export function expandIntentGoal(
  intentId: ComposerIntentId | string | null | undefined,
  userText: string,
  translate: (key: string, params?: Record<string, string>) => string,
): ExpandedIntentGoal | null {
  const intent = findComposerIntent(intentId);
  if (!intent) return null;
  const args = userText.trim();
  const template = translate(intent.goalKey);
  const goal = args
    ? weaveIntentArgs(
        template,
        args,
        translate("slash.argsTopic", { args }),
      )
    : template;
  const source = args
    ? `intent:${intent.id} ${args}`
    : `intent:${intent.id}`;
  return {
    goal,
    intent,
    source,
    sendAction: intent.sendAction ?? "create_task",
  };
}

/**
 * Expand either a structured intent mode or a leading slash command.
 * Intent mode wins when set (slash in textarea is unusual with a chip).
 * Slash path preserves existing expandSlashGoal behavior.
 */
export function expandComposerGoal(
  text: string,
  opts: {
    intentId?: ComposerIntentId | string | null;
    translate: (key: string, params?: Record<string, string>) => string;
    slashCommands?: SlashCommand[];
  },
): ExpandedGoal & {
  intent: ComposerIntentDef | null;
  sendAction: "create_task" | "open_schedule";
} {
  const fromIntent = expandIntentGoal(opts.intentId, text, opts.translate);
  if (fromIntent) {
    return {
      goal: fromIntent.goal,
      command: null,
      source: fromIntent.source,
      intent: fromIntent.intent,
      sendAction: fromIntent.sendAction,
    };
  }
  const fromSlash = expandSlashGoal(
    text,
    opts.translate,
    opts.slashCommands ?? SLASH_COMMANDS,
  );
  return {
    ...fromSlash,
    intent: null,
    sendAction: "create_task",
  };
}

/**
 * Hidden defaults applied when arming an intent (not when user already set them).
 */
export type IntentHiddenDefaults = {
  effort?: EffortLevel;
  rolePackId?: string | null;
  planFirst?: boolean;
  needsWorkspace: boolean;
  sendAction: "create_task" | "open_schedule";
};

export function intentHiddenDefaults(
  intentId: ComposerIntentId | string | null | undefined,
): IntentHiddenDefaults | null {
  const intent = findComposerIntent(intentId);
  if (!intent) return null;
  return {
    ...(intent.effort ? { effort: intent.effort } : {}),
    ...(intent.preferRolePack
      ? { rolePackId: intent.preferRolePack }
      : {}),
    ...(intent.planFirst ? { planFirst: true } : {}),
    needsWorkspace: Boolean(intent.needsWorkspace),
    sendAction: intent.sendAction ?? "create_task",
  };
}

/**
 * Equivalence helper for tests: intent expansion vs slash expansion for
 * intents that share a slash fill template.
 */
export function intentSlashEquivalentGoals(
  intentId: ComposerIntentId,
  userArgs: string,
  translate: (key: string, params?: Record<string, string>) => string,
): { intentGoal: string; slashGoal: string; comparable: boolean } {
  const intent = findComposerIntent(intentId);
  if (!intent?.slashToken) {
    const expanded = expandIntentGoal(intentId, userArgs, translate);
    return {
      intentGoal: expanded?.goal ?? "",
      slashGoal: "",
      comparable: false,
    };
  }
  const intentExpanded = expandIntentGoal(intentId, userArgs, translate);
  const slashText = userArgs.trim()
    ? `/${intent.slashToken} ${userArgs.trim()}`
    : `/${intent.slashToken}`;
  const slashExpanded = expandSlashGoal(slashText, translate);
  return {
    intentGoal: intentExpanded?.goal ?? "",
    slashGoal: slashExpanded.goal,
    comparable: true,
  };
}

/**
 * Mode transition: select / clear / switch intent. Pure for easy testing.
 */
export type ComposerModeState = {
  intentId: ComposerIntentId | null;
  /** Effort before intent auto-escalation (restore on clear if still applied). */
  savedEffort: EffortLevel | null;
  appliedEffort: EffortLevel | null;
  /** Role pack before intent preference (restore on clear if still applied). */
  savedRolePackId: string | null | undefined;
  appliedRolePackId: string | null;
  /** Plan-first before intent (restore on clear if still applied). */
  savedPlanFirst: boolean | null;
  appliedPlanFirst: boolean;
};

export function emptyComposerModeState(): ComposerModeState {
  return {
    intentId: null,
    savedEffort: null,
    appliedEffort: null,
    savedRolePackId: undefined,
    appliedRolePackId: null,
    savedPlanFirst: null,
    appliedPlanFirst: false,
  };
}

export type ComposerModeApply = {
  state: ComposerModeState;
  setEffort?: EffortLevel;
  setRolePackId?: string | null;
  setPlanFirst?: boolean;
};

/** Arm or switch intent; returns optional control updates for hidden defaults. */
export function selectComposerIntent(
  state: ComposerModeState,
  intentId: ComposerIntentId,
  current: {
    effort: EffortLevel;
    rolePackId: string | null;
    planFirst: boolean;
  },
): ComposerModeApply {
  const defaults = intentHiddenDefaults(intentId);
  if (!defaults) return { state };

  let next: ComposerModeState = {
    ...state,
    intentId,
  };
  const out: ComposerModeApply = { state: next };

  if (defaults.effort) {
    // Only save/restore around our own applied escalations.
    if (state.appliedEffort == null) {
      next = { ...next, savedEffort: current.effort, appliedEffort: defaults.effort };
    } else {
      next = { ...next, appliedEffort: defaults.effort };
    }
    out.setEffort = defaults.effort;
  } else if (state.appliedEffort) {
    // Switching to an intent without effort default — restore if still applied.
    if (current.effort === state.appliedEffort && state.savedEffort != null) {
      out.setEffort = state.savedEffort;
    }
    next = { ...next, savedEffort: null, appliedEffort: null };
  }

  if (defaults.rolePackId) {
    if (state.appliedRolePackId == null) {
      next = {
        ...next,
        savedRolePackId: current.rolePackId,
        appliedRolePackId: defaults.rolePackId,
      };
    } else {
      next = { ...next, appliedRolePackId: defaults.rolePackId };
    }
    // Only apply prefer pack when user has no pack selected (General).
    if (current.rolePackId == null) {
      out.setRolePackId = defaults.rolePackId;
    }
  }

  if (defaults.planFirst) {
    if (!state.appliedPlanFirst) {
      next = {
        ...next,
        savedPlanFirst: current.planFirst,
        appliedPlanFirst: true,
      };
    }
    out.setPlanFirst = true;
  } else if (state.appliedPlanFirst) {
    if (current.planFirst && state.savedPlanFirst != null) {
      out.setPlanFirst = state.savedPlanFirst;
    }
    next = { ...next, savedPlanFirst: null, appliedPlanFirst: false };
  }

  out.state = next;
  return out;
}

/** Clear active intent and restore auto-applied defaults when still current. */
export function clearComposerIntent(
  state: ComposerModeState,
  current: {
    effort: EffortLevel;
    rolePackId: string | null;
    planFirst: boolean;
  },
): ComposerModeApply {
  if (!state.intentId) return { state: emptyComposerModeState() };

  const out: ComposerModeApply = { state: emptyComposerModeState() };

  if (
    state.appliedEffort &&
    current.effort === state.appliedEffort &&
    state.savedEffort != null
  ) {
    out.setEffort = state.savedEffort;
  }
  if (
    state.appliedRolePackId &&
    current.rolePackId === state.appliedRolePackId &&
    state.savedRolePackId !== undefined
  ) {
    out.setRolePackId = state.savedRolePackId ?? null;
  }
  if (
    state.appliedPlanFirst &&
    current.planFirst &&
    state.savedPlanFirst != null
  ) {
    out.setPlanFirst = state.savedPlanFirst;
  }

  return out;
}
