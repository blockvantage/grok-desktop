import { describe, expect, it } from "vitest";
import {
  clearComposerIntent,
  COMPOSER_INTENT_CATALOG,
  emptyComposerModeState,
  expandComposerGoal,
  expandIntentGoal,
  intentHiddenDefaults,
  intentSlashEquivalentGoals,
  pickComposerIntents,
  selectComposerIntent,
  type ComposerIntentId,
} from "./composer-intents";
import { expandSlashGoal } from "./composer-input";

const en: Record<string, string> = {
  "slash.briefGoal":
    "Draft a clear, structured brief with audience, message, channels, and next steps",
  "slash.researchGoal":
    "Research this topic thoroughly. Separate facts from inference, list sources, and save notes under ./artifacts.",
  "slash.organizeGoal":
    "Organize files in this folder into a clear structure and summarize what you did",
  "slash.imageGoal":
    "Generate a polished product image for this project and save it under ./artifacts with a short caption file",
  "slash.videoGoal":
    "Generate a short polished teaser video for this project and save it under ./artifacts as an mp4",
  "intent.scheduleGoal":
    "Set up a recurring schedule for this work. Propose a clear name, cadence, and goal template the user can confirm.",
  "intent.summarizeGoal":
    "Summarize this project: current status, key decisions, recent changes, and open items. Use workspace files and memory when available.",
  "slash.argsTopic": "Topic: {args}",
};

function translate(key: string, params?: Record<string, string>): string {
  let s = en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(`{${k}}`, v);
    }
  }
  return s;
}

describe("composer-intents catalog", () => {
  it("exposes the seven Phase 3 workflows including video", () => {
    const ids = COMPOSER_INTENT_CATALOG.map((d) => d.id).sort();
    expect(ids).toEqual(
      [
        "brief",
        "image",
        "organize",
        "research",
        "schedule",
        "summarize",
        "video",
      ].sort(),
    );
    expect(COMPOSER_INTENT_CATALOG.find((d) => d.id === "video")?.icon).toBe(
      "video",
    );
  });

  it("pickComposerIntents ranks pack affinity and returns up to limit", () => {
    const picked = pickComposerIntents(
      { rolePackId: "research", hasWorkspace: true },
      3,
    );
    expect(picked.length).toBe(3);
    expect(picked[0]?.id).toBe("research");
  });
});

describe("intent expansion vs slash equivalence", () => {
  const comparable: ComposerIntentId[] = [
    "brief",
    "research",
    "image",
    "video",
    "organize",
  ];

  for (const id of comparable) {
    it(`${id}: chip path and slash path expand to the same goal (with args)`, () => {
      const { intentGoal, slashGoal, comparable: ok } =
        intentSlashEquivalentGoals(id, "launch Q3", translate);
      expect(ok).toBe(true);
      expect(intentGoal).toBe(slashGoal);
      expect(intentGoal).toContain("Topic: launch Q3");
      // No slash token left in expanded goal
      expect(intentGoal).not.toMatch(/^\/(brief|research|image|video|organize)/);
    });

    it(`${id}: chip path and slash path expand to the same goal (no args)`, () => {
      const { intentGoal, slashGoal, comparable: ok } =
        intentSlashEquivalentGoals(id, "", translate);
      expect(ok).toBe(true);
      expect(intentGoal).toBe(slashGoal);
      expect(intentGoal.length).toBeGreaterThan(10);
    });
  }

  it("schedule and summarize expand without slash counterparts", () => {
    for (const id of ["schedule", "summarize"] as const) {
      const expanded = expandIntentGoal(id, "weekly standup", translate);
      expect(expanded).not.toBeNull();
      expect(expanded!.goal).toContain("Topic: weekly standup");
      expect(expanded!.source).toBe(`intent:${id} weekly standup`);
      expect(expanded!.goal).not.toMatch(/^\/schedule|^\/summarize/);
    }
  });

  it("expandComposerGoal prefers intent mode over slash text", () => {
    const r = expandComposerGoal("/brief ignored slash", {
      intentId: "research",
      translate,
    });
    expect(r.intent?.id).toBe("research");
    expect(r.goal).toContain("Research this topic");
    expect(r.source).toContain("intent:research");
  });

  it("expandComposerGoal falls back to slash when no intent", () => {
    const r = expandComposerGoal("/brief launch", {
      intentId: null,
      translate,
    });
    expect(r.command?.id).toBe("brief");
    expect(r.goal).toBe(expandSlashGoal("/brief launch", translate).goal);
    expect(r.source).toBe("/brief launch");
  });
});

describe("composer mode select / clear / switch", () => {
  it("selecting research applies heavy effort and planFirst", () => {
    const r = selectComposerIntent(emptyComposerModeState(), "research", {
      effort: "normal",
      rolePackId: null,
      planFirst: false,
    });
    expect(r.state.intentId).toBe("research");
    expect(r.setEffort).toBe("heavy");
    expect(r.setPlanFirst).toBe(true);
    expect(r.setRolePackId).toBe("research");
  });

  it("clearing restores auto-applied effort and planFirst", () => {
    const armed = selectComposerIntent(emptyComposerModeState(), "research", {
      effort: "normal",
      rolePackId: null,
      planFirst: false,
    });
    const cleared = clearComposerIntent(armed.state, {
      effort: "heavy",
      rolePackId: "research",
      planFirst: true,
    });
    expect(cleared.state.intentId).toBeNull();
    expect(cleared.setEffort).toBe("normal");
    expect(cleared.setPlanFirst).toBe(false);
    expect(cleared.setRolePackId).toBeNull();
  });

  it("clear does not clobber user-changed effort after arm", () => {
    const armed = selectComposerIntent(emptyComposerModeState(), "research", {
      effort: "normal",
      rolePackId: "coder",
      planFirst: false,
    });
    // User moved effort to fast after arm
    const cleared = clearComposerIntent(armed.state, {
      effort: "fast",
      rolePackId: "coder",
      planFirst: true,
    });
    expect(cleared.setEffort).toBeUndefined();
  });

  it("switching brief → research updates applied effort", () => {
    const brief = selectComposerIntent(emptyComposerModeState(), "brief", {
      effort: "normal",
      rolePackId: null,
      planFirst: false,
    });
    const research = selectComposerIntent(brief.state, "research", {
      effort: brief.setEffort ?? "normal",
      rolePackId: brief.setRolePackId ?? null,
      planFirst: Boolean(brief.setPlanFirst),
    });
    expect(research.state.intentId).toBe("research");
    expect(research.setEffort).toBe("heavy");
  });

  it("intentHiddenDefaults exposes organize workspace need", () => {
    expect(intentHiddenDefaults("organize")?.needsWorkspace).toBe(true);
    expect(intentHiddenDefaults("schedule")?.sendAction).toBe("open_schedule");
  });
});
