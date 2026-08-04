import { describe, expect, it } from "vitest";
import { buildCoworkerHomeModel } from "./coworker-home";

function memStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

describe("buildCoworkerHomeModel", () => {
  it("composes briefing, board, recipes, discovery from live lists", () => {
    const storage = memStorage({
      "grokdesk.recipes.v1": JSON.stringify({
        recipes: [
          {
            id: "r1",
            title: "Weekly email",
            goal: "Draft weekly status email",
            useCount: 3,
            createdAt: "2026-07-01T00:00:00.000Z",
            lastUsedAt: "2026-07-14T00:00:00.000Z",
          },
        ],
      }),
    });

    const model = buildCoworkerHomeModel({
      now: new Date("2026-07-15T08:00:00"),
      storage,
      tasks: [
        {
          id: "t1",
          goal: "Needs approval",
          status: "waiting_approval",
          updatedAt: "2026-07-15T07:00:00.000Z",
        },
        {
          id: "t2",
          goal: "Running research",
          status: "running",
          updatedAt: "2026-07-15T07:30:00.000Z",
        },
      ],
      schedules: [
        { id: "s1", name: "Daily notes", enabled: true },
      ],
      inbox: [
        {
          id: "i1",
          kind: "approval",
          title: "Approve something",
          read: false,
        },
      ],
      scheduleRuns: [
        {
          scheduleId: "s1",
          scheduleName: "Daily notes",
          status: "done",
          finishedAt: "2026-07-15T02:00:00.000Z",
        },
      ],
      usage: {
        hasUsedQueue: false,
        scheduleCount: 1,
        hasUsedBrowser: false,
        connectorCount: 0,
        memoryCount: 0,
        recipeCount: 1,
        hasExported: false,
        hasMultiTasked: true,
        hasRemote: false,
        doneCount: 5,
      },
      connectors: {
        catalog: [
          { id: "filesystem", name: "Filesystem", recommended: true },
          { id: "fetch", name: "Fetch", recommended: true },
        ],
        enabledIds: ["filesystem"],
      },
    });

    expect(model.briefing.actionable).toBe(true);
    expect(model.showWorkBoard).toBe(true);
    expect(model.recipes[0]?.goal).toMatch(/weekly status/i);
    expect(model.discovery.length).toBeGreaterThan(0);
    expect(model.discovery.map((d) => d.id)).not.toContain("recipes");
    expect(model.showScheduleDigest).toBe(true);
    expect(model.nextConnector?.presetId).toBe("fetch");
  });
});
