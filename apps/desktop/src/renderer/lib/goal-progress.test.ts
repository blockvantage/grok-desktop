import { describe, it, expect, afterEach } from "vitest";
import { setActiveLocale } from "@/i18n/active";
import { projectGoalProgress } from "./goal-progress";

// Locale is module-level state; restore it even if an assertion throws.
afterEach(() => setActiveLocale("en"));

describe("projectGoalProgress (C1)", () => {
  it("builds line from goal_update events", () => {
    const v = projectGoalProgress({
      events: [
        {
          kind: "goal_update",
          payload: { objective: "Ship parity", status: "Writing tests" },
        },
      ],
    });
    expect(v?.source).toBe("goal_event");
    expect(v?.line).toContain("Working toward…");
    expect(v?.line).toContain("Ship parity");
    expect(v?.line).toContain("Writing tests");
  });

  it("falls back to task goal when no events", () => {
    const v = projectGoalProgress({
      events: [],
      taskGoal: "Organize the project folders carefully",
    });
    expect(v?.source).toBe("task_goal");
    expect(v?.line).toMatch(/Working toward… Organize/);
  });

  it("returns null when nothing available", () => {
    expect(
      projectGoalProgress({
        events: [],
        taskGoal: null,
        allowTaskGoalFallback: false,
      }),
    ).toBeNull();
  });

  it("drops sticky Session ready setup once real work text arrives", () => {
    const v = projectGoalProgress({
      events: [
        {
          kind: "step",
          payload: { title: "Session ready — working on your goal.", status: "start" },
        },
        {
          kind: "message",
          payload: {
            channel: "text",
            text: "Generating a brand-aligned hero image for Payverge.",
          },
        },
      ],
      taskGoal: "generate an image of this project",
    });
    expect(v?.line).toContain("Generating a brand-aligned hero image");
    expect(v?.line).not.toMatch(/Session ready/i);
  });

  it("collapses duplicated status clauses", () => {
    const v = projectGoalProgress({
      events: [
        {
          kind: "goal_update",
          payload: {
            objective: "Session ready — working on your goal.",
            status: "Session ready — working on your goal.",
          },
        },
      ],
    });
    // Stale setup-only → fall through to null objective after filter, or collapsed
    expect(v?.line ?? "").not.toMatch(/—.*—/);
  });

  it("uses the translated prefix and still collapses under a non-en locale", () => {
    setActiveLocale("fr");
    expect(
      projectGoalProgress({
        events: [],
        taskGoal: "Organiser les dossiers",
      })?.line,
    ).toBe("Travaille sur… Organiser les dossiers");
    // Collapse is regex-driven off the prefix — it must track the locale too.
    expect(
      projectGoalProgress({
        events: [
          {
            kind: "goal_update",
            payload: { objective: "Créer le rapport — Créer le rapport" },
          },
        ],
      })?.line,
    ).toBe("Travaille sur… Créer le rapport");
  });

  it("softens run_progress Saved image/video step titles when softenSavedClaims", () => {
    // Shipped path: gateway maps run_progress → step with title = message
    // (engine-grok: `Saved N image/video file(s) under ${where}`).
    const savedTitle =
      "Saved 1 image/video file(s) under /Users/me/Library/Application Support/GrokDesk/workspaces/grok-chat-fpDqsc/images";
    const soft = projectGoalProgress({
      events: [
        {
          kind: "step",
          payload: { title: savedTitle, status: "start" },
        },
      ],
      softenSavedClaims: true,
    });
    expect(soft?.source).toBe("goal_event");
    expect(soft?.line).toBeTruthy();
    expect(soft!.line).not.toMatch(
      /Saved\s+\d+\s+image\/video\s+file\(s\)\s+under/i,
    );
    expect(soft!.line).toMatch(/Produced/i);
    expect(soft!.line).toMatch(/no longer on disk/i);

    const hard = projectGoalProgress({
      events: [
        {
          kind: "step",
          payload: { title: savedTitle, status: "start" },
        },
      ],
      softenSavedClaims: false,
    });
    expect(hard?.line).toMatch(/Saved 1 image\/video file\(s\) under/i);
  });
});
