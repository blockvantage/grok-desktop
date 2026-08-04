import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ScheduleRule } from "@grokdesk/shared";
import { ScheduledView } from "./scheduled-view";
import {
  scheduleFromTaskNavState,
  seedScheduleFormGoal,
} from "@/lib/imagine-schedule-nav";
import { buildCreateTaskParams } from "@/lib/create-task-optimistic";

function rule(partial: Partial<ScheduleRule> = {}): ScheduleRule {
  return {
    id: "rule-1",
    name: "Morning brief",
    goalTemplate: "Summarize overnight PRs",
    cron: "0 9 * * 1-5",
    timezone: "UTC",
    enabled: true,
    quietHoursRespect: true,
    approvalMode: "balanced",
    model: "grok-4.5",
    effort: "normal",
    workspaceRoots: ["/tmp/ws"],
    rolePack: null,
    createdAt: "2026-07-28T09:00:00.000Z",
    updatedAt: "2026-07-28T09:00:00.000Z",
    ...partial,
  };
}

function render(
  schedules: ScheduleRule[],
  opts?: { initialGoal?: string | null },
) {
  return renderToStaticMarkup(
    <ScheduledView
      schedules={schedules}
      root="/tmp/ws"
      models={["grok-4.5"]}
      onPickRoot={vi.fn()}
      onCreate={vi.fn()}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
      onError={vi.fn()}
      initialGoal={opts?.initialGoal}
    />,
  );
}

describe("ScheduledView", () => {
  it("gives every schedule row a localized delete affordance", () => {
    const html = render([rule(), rule({ id: "rule-2", name: "Weekly recap" })]);

    // Match whole tags, then assert attributes independently — the rendered
    // attribute order is Radix's to change, and ids are not single-digit.
    const triggers =
      html.match(/<[a-z]+[^>]*\sdata-schedule-delete="[^"]*"[^>]*>/g) ?? [];
    expect(triggers).toHaveLength(2);

    const first = triggers.find((tag) =>
      tag.includes('data-schedule-delete="rule-1"'),
    );
    expect(first).toBeDefined();
    expect(first).toContain('aria-label="Delete schedule"');
  });

  it("seeds create-form goal from initialGoal (schedule intent draft)", () => {
    const draft =
      "Set up a recurring schedule for daily standup notes at 9am.";
    const html = render([], { initialGoal: draft });
    // Empty form regression: goal input must carry the draft value attribute.
    expect(html).toContain('data-testid="scheduled-goal-input"');
    expect(html).toContain(draft);
    // Without initialGoal the goal field stays empty.
    const blank = render([]);
    expect(blank).toContain('data-testid="scheduled-goal-input"');
    expect(blank).not.toContain(draft);
  });

  it("accepts scheduleFromTaskNavState goal from create-task schedule intent path", () => {
    // Real shipped path: buildCreateTaskParams(schedule intent) → nav → seed form.
    const params = buildCreateTaskParams({
      goal: "daily standup",
      root: "/ws",
      model: "grok-4.5",
      effort: "normal",
      approvalMode: "balanced",
      rolePack: null,
      intentId: "schedule",
    });
    expect(params.sendAction).toBe("open_schedule");
    expect(params.goal.length).toBeGreaterThan(10);

    const nav = scheduleFromTaskNavState(params.goal);
    expect(nav.nav).toBe("scheduled");
    const seeded = seedScheduleFormGoal(nav.goal);
    expect(seeded).toBe(params.goal);

    const html = render([], { initialGoal: seeded });
    // Form must not stay empty when given the expanded schedule goal.
    expect(html).toContain(seeded.slice(0, 40));
  });
});
