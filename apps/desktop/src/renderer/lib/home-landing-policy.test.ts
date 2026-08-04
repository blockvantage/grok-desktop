import { describe, expect, it } from "vitest";
import { planHomeLanding } from "./home-landing-policy";
import type { WorkBoardSnapshot } from "./concurrent-work-board";

function board(partial: Partial<WorkBoardSnapshot>): WorkBoardSnapshot {
  return {
    items: [],
    needsYouCount: 0,
    workingCount: 0,
    failedCount: 0,
    headline: "",
    ...partial,
  };
}

describe("planHomeLanding", () => {
  it("never surfaces failed tasks on Home (retry lives in Chats)", () => {
    const plan = planHomeLanding({
      workBoard: board({
        failedCount: 6,
        items: [
          {
            taskId: "f1",
            title: "fail one",
            goal: "g1",
            status: "failed",
            rawStatus: "failed",
            updatedAt: "2026-07-15T10:00:00.000Z",
            progress: null,
            activity: null,
            urgency: 80,
          },
          {
            taskId: "f2",
            title: "fail two",
            goal: "g2",
            status: "failed",
            rawStatus: "failed",
            updatedAt: "2026-07-15T09:00:00.000Z",
            progress: null,
            activity: null,
            urgency: 80,
          },
        ],
      }),
      resume: { type: "none" },
      recipes: [],
      discovery: [
        {
          id: "queue_stack",
          titleKey: "discovery.queueTitle",
          bodyKey: "discovery.queueBody",
          cta: "tasks",
          weight: 90,
        },
      ],
      recentDeliverables: [
        {
          id: "a1",
          title: "index.html",
          path: "/x",
          taskId: null,
          createdAt: "2026-07-15T00:00:00.000Z",
        },
      ],
      staleTasks: [],
      hasNeedsYouNotice: false,
      hasRunningNotice: false,
    });

    expect(plan.attention).toBeNull();
    expect(plan.showLiveWork).toBe(false);
    // Calm desk secondaries still allowed when only failures exist.
    expect(plan.showDiscovery).toBe(true);
    expect(plan.showRecentDeliverables).toBe(false);
    // Discovery claims the secondary slot — no smart-start grid on top.
    expect(plan.showSmartStarts).toBe(false);
    expect(plan.maxRecommendedActions).toBe(3);
    expect(plan.useBriefingAsSubtitle).toBe(true);
  });

  it("shows live work only (not failed) and prefers recipes when calm", () => {
    const plan = planHomeLanding({
      workBoard: board({
        workingCount: 1,
        items: [
          {
            taskId: "w1",
            title: "Research",
            goal: "research",
            status: "working",
            rawStatus: "running",
            updatedAt: "2026-07-15T11:00:00.000Z",
            progress: null,
            activity: null,
            urgency: 60,
          },
        ],
      }),
      resume: { type: "none" },
      recipes: [
        {
          id: "r1",
          title: "Weekly",
          goal: "weekly",
          useCount: 1,
          createdAt: "2026-07-01T00:00:00.000Z",
          lastUsedAt: null,
        },
      ],
      discovery: [
        {
          id: "queue_stack",
          titleKey: "discovery.queueTitle",
          bodyKey: "discovery.queueBody",
          cta: "tasks",
          weight: 90,
        },
      ],
      recentDeliverables: [],
      staleTasks: [],
      hasNeedsYouNotice: false,
      hasRunningNotice: false,
    });

    expect(plan.liveWorkItems).toHaveLength(1);
    expect(plan.showDiscovery).toBe(false); // busy desk
    expect(plan.showRecipes).toBe(false);
    expect(plan.showSmartStarts).toBe(false); // busy: current work only
  });

  it("on a calm desk shows one secondary: recipes over discovery", () => {
    const plan = planHomeLanding({
      workBoard: board({}),
      resume: { type: "none" },
      recipes: [
        {
          id: "r1",
          title: "Weekly",
          goal: "weekly",
          useCount: 1,
          createdAt: "2026-07-01T00:00:00.000Z",
          lastUsedAt: null,
        },
      ],
      discovery: [
        {
          id: "queue_stack",
          titleKey: "discovery.queueTitle",
          bodyKey: "discovery.queueBody",
          cta: "tasks",
          weight: 90,
        },
      ],
      recentDeliverables: [
        {
          id: "a1",
          title: "file",
          path: "/f",
          taskId: null,
          createdAt: "2026-07-15T00:00:00.000Z",
        },
      ],
      staleTasks: [],
      hasNeedsYouNotice: false,
      hasRunningNotice: false,
    });

    expect(plan.showRecipes).toBe(true);
    expect(plan.showDiscovery).toBe(false);
    expect(plan.showRecentDeliverables).toBe(false);
    expect(plan.showSmartStarts).toBe(false); // recipes own the ≤3 actions
    expect(plan.recipes.length).toBeLessThanOrEqual(3);
    expect(plan.attention).toBeNull();
    // Resume strip removed — never mirror drafts under the composer.
    expect(plan.showResume).toBe(false);
  });

  it("on an empty calm desk offers smart starts as the only recommended actions", () => {
    const plan = planHomeLanding({
      workBoard: board({}),
      resume: { type: "none" },
      recipes: [],
      discovery: [],
      recentDeliverables: [],
      staleTasks: [],
      hasNeedsYouNotice: false,
      hasRunningNotice: false,
    });
    expect(plan.showSmartStarts).toBe(true);
    expect(plan.maxRecommendedActions).toBe(3);
    expect(plan.showRecipes).toBe(false);
  });

  it("does not stack smart starts with deliverables on a calm desk", () => {
    const plan = planHomeLanding({
      workBoard: board({}),
      resume: { type: "none" },
      recipes: [],
      discovery: [],
      recentDeliverables: [
        {
          id: "a1",
          title: "file",
          path: "/f",
          taskId: null,
          createdAt: "2026-07-15T00:00:00.000Z",
        },
      ],
      staleTasks: [],
      hasNeedsYouNotice: false,
      hasRunningNotice: false,
    });
    expect(plan.showRecentDeliverables).toBe(true);
    expect(plan.showSmartStarts).toBe(false);
  });

  it("never shows Pick up where you left off, even with a restore draft", () => {
    const plan = planHomeLanding({
      workBoard: board({}),
      resume: {
        type: "restore_home_draft",
        draft: "Continue the previous task draft here",
        workspaceRoot: null,
      },
      recipes: [],
      discovery: [],
      recentDeliverables: [],
      staleTasks: [],
      hasNeedsYouNotice: false,
      hasRunningNotice: false,
    });
    expect(plan.showResume).toBe(false);
  });
});
