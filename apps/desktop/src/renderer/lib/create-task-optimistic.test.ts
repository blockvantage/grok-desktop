import { describe, it, expect } from "vitest";
import {
  buildCreateTaskParams,
  buildOptimisticTask,
  buildFollowUpTaskParams,
  canFollowUpOnTask,
  mergeCreatedTask,
  dropOptimisticTasks,
  resolveFollowUpWorkspaceRoots,
  weaveFollowUpComposerGoal,
} from "./create-task-optimistic";
import type { Task } from "@grokdesk/shared";

const form = {
  goal: "  do the thing  ",
  root: "/ws",
  model: "grok-4.5",
  effort: "normal" as const,
  approvalMode: "balanced" as const,
  rolePack: "coder",
};

describe("create-task-optimistic", () => {
  it("builds create params with trimmed goal and roots", () => {
    expect(buildCreateTaskParams(form)).toEqual({
      goal: "do the thing",
      workspaceRoots: ["/ws"],
      model: "grok-4.5",
      effort: "normal",
      approvalMode: "balanced",
      rolePack: "coder",
      locale: "en",
    });
  });

  it("omits effortExplicit unless the form marks user choice", () => {
    expect(buildCreateTaskParams(form)).not.toHaveProperty("effortExplicit");
    expect(
      buildCreateTaskParams({ ...form, effortExplicit: true }),
    ).toMatchObject({ effortExplicit: true });
  });

  it("expands a slash goal at param-build time and carries goalSource", () => {
    const p = buildCreateTaskParams({ ...form, goal: "/brief launch" });
    expect(p.goal).not.toContain("/brief");
    expect(p.goalSource).toBe("/brief launch");
    expect(p.locale).toBe("en");
  });

  it("expands a structured intent mode without dumping slash into goalSource", () => {
    const p = buildCreateTaskParams({
      ...form,
      goal: "launch Q3",
      intentId: "brief",
    });
    expect(p.goal).toMatch(/brief|audience|message/i);
    expect(p.goal).toContain("Topic: launch Q3");
    expect(p.goalSource).toBe("intent:brief launch Q3");
    expect(p.goal).not.toMatch(/^\/brief/);
  });

  it("intent brief and slash /brief produce the same expanded goal", () => {
    const fromIntent = buildCreateTaskParams({
      ...form,
      goal: "launch",
      intentId: "brief",
    });
    const fromSlash = buildCreateTaskParams({
      ...form,
      goal: "/brief launch",
    });
    expect(fromIntent.goal).toBe(fromSlash.goal);
  });

  it("schedule intent marks open_schedule instead of create_task", () => {
    const p = buildCreateTaskParams({
      ...form,
      goal: "daily standup",
      intentId: "schedule",
    });
    expect(p.sendAction).toBe("open_schedule");
    expect(p.goalSource).toContain("intent:schedule");
  });

  it("schedule intent expanded goal is accepted by scheduleFromTaskNavState seed", async () => {
    const { scheduleFromTaskNavState, seedScheduleFormGoal } = await import(
      "./imagine-schedule-nav"
    );
    const p = buildCreateTaskParams({
      ...form,
      goal: "weekly review",
      intentId: "schedule",
    });
    expect(p.sendAction).toBe("open_schedule");
    const nav = scheduleFromTaskNavState(p.goal);
    expect(nav.nav).toBe("scheduled");
    // ScheduledView uses seedScheduleFormGoal(initialGoal) for the form field.
    expect(seedScheduleFormGoal(nav.goal)).toBe(p.goal);
    expect(seedScheduleFormGoal(nav.goal)).not.toBe("");
  });

  it("sends plain goals verbatim without goalSource", () => {
    const p = buildCreateTaskParams({ ...form, goal: "hello" });
    expect(p.goal).toBe("hello");
    expect(p.goalSource).toBeUndefined();
  });

  it("includes planFirst when the draft-a-plan toggle is on", () => {
    expect(buildCreateTaskParams({ ...form, planFirst: true })).toMatchObject({
      planFirst: true,
    });
    expect(buildCreateTaskParams(form)).not.toHaveProperty("planFirst");
  });

  it("weaves video studio duration, 4:3, voice, still, and workspace videos/", () => {
    const p = buildCreateTaskParams({
      ...form,
      goal: "/video launch teaser",
      mediaStudio: {
        kind: "video",
        durationSec: 10,
        aspectRatio: "4:3",
        voice: "eve",
      },
      attachments: [
        {
          id: "att-1",
          name: "poster.png",
          sourcePath: "/ws/poster.png",
          kind: "image",
        },
      ],
    });
    expect(p.goal).toContain("Duration: 10 seconds");
    expect(p.goal).toContain("Aspect ratio: 4:3");
    expect(p.goal).toContain('preset voice "eve"');
    expect(p.goal).toContain("/ws/poster.png");
    expect(p.goal).toMatch(/workspace videos\//);
    expect(p.goal).toMatch(/Artifacts/);
  });

  it("weaves image aspect and workspace images/ on /image", () => {
    const p = buildCreateTaskParams({
      ...form,
      goal: "/image product shot",
      mediaStudio: { kind: "image", aspectRatio: "3:4" },
    });
    expect(p.goal).toContain("Aspect ratio: 3:4");
    expect(p.goal).toMatch(/workspace images\//);
    expect(p.goal).not.toContain("Duration:");
  });

  it("does not weave leftover video studio onto a plain brief", () => {
    const p = buildCreateTaskParams({
      ...form,
      goal: "hello",
      mediaStudio: {
        kind: "video",
        durationSec: 10,
        aspectRatio: "4:3",
      },
    });
    expect(p.goal).toBe("hello");
    expect(p.goal).not.toContain("Duration:");
  });

  it("weaves workspace images/ when the image intent is armed", () => {
    const p = buildCreateTaskParams({
      ...form,
      goal: "product shot",
      intentId: "image",
      mediaStudio: { kind: "image", aspectRatio: "1:1" },
    });
    expect(p.goal).toContain("Aspect ratio: 1:1");
    expect(p.goal).toMatch(/workspace images\//);
  });

  it("includes the stable mutation id allocated with the optimistic task", () => {
    expect(buildCreateTaskParams(form, "optimistic-create-1")).toMatchObject({
      clientMutationId: "optimistic-create-1",
    });
  });

  it("optimistic task denies shell until real policy arrives", () => {
    const t = buildOptimisticTask({
      ...form,
      id: "optimistic-1",
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    expect(t.id).toBe("optimistic-1");
    expect(t.status).toBe("queued");
    expect(t.policySnapshot.allowShell).toBe(false);
    expect(t.goal).toBe("do the thing");
  });

  it("mergeCreatedTask drops optimistic placeholders", () => {
    const optimistic = buildOptimisticTask({
      ...form,
      id: "optimistic-9",
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    const real = { ...optimistic, id: "real-1" } as Task;
    const next = mergeCreatedTask([optimistic], real);
    expect(next.map((t) => t.id)).toEqual(["real-1"]);
  });

  it("dropOptimisticTasks removes only optimistic ids", () => {
    const a = buildOptimisticTask({
      ...form,
      id: "optimistic-a",
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    const b = { ...a, id: "real-b" } as Task;
    expect(dropOptimisticTasks([a, b]).map((t) => t.id)).toEqual(["real-b"]);
  });

  it("resolveFollowUpWorkspaceRoots prefers parent roots over composer", () => {
    const base = buildOptimisticTask({
      ...form,
      id: "real-1",
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    expect(resolveFollowUpWorkspaceRoots(base, "/other")).toEqual(["/ws"]);
    expect(
      resolveFollowUpWorkspaceRoots(
        { ...base, policySnapshot: { ...base.policySnapshot, workspaceRoots: [] } },
        " /composer ",
      ),
    ).toEqual(["/composer"]);
  });

  it("buildFollowUpTaskParams binds parentTaskId and inherits policy", () => {
    const base = buildOptimisticTask({
      ...form,
      id: "parent-1",
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    const params = buildFollowUpTaskParams({
      goalText: "next step",
      base,
      composerRoot: "/ignored",
      fallbackModel: "fallback",
      fallbackEffort: "heavy",
      fallbackApprovalMode: "strict",
    });
    expect(params.parentTaskId).toBe("parent-1");
    expect(params.goal).toBe("next step");
    expect(params.workspaceRoots).toEqual(["/ws"]);
    expect(params.model).toBe("grok-4.5");
    expect(params.approvalMode).toBe("balanced");
    // Live form effort wins over parent so mid-conversation changes apply.
    expect(params.effort).toBe("heavy");
    expect(params.effortExplicit).toBe(true);
  });

  it("weaves video studio onto a follow-up /video turn", () => {
    const base = buildOptimisticTask({
      ...form,
      id: "parent-1",
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    const params = buildFollowUpTaskParams({
      goalText: "/video hero clip",
      base,
      composerRoot: "/ws",
      fallbackModel: "grok-4.5",
      fallbackEffort: "normal",
      fallbackApprovalMode: "balanced",
      mediaStudio: { kind: "video", durationSec: 8, aspectRatio: "3:4" },
    });
    expect(params.goal).toContain("/video hero clip");
    expect(params.goal).toContain("Duration: 8 seconds");
    expect(params.goal).toContain("Aspect ratio: 3:4");
    expect(params.goal).toMatch(/workspace videos\//);
  });

  it("weaves default duration onto /video even without studio form state", () => {
    const p = buildCreateTaskParams({ ...form, goal: "/video teaser" });
    expect(p.goal).toContain("Duration: 6 seconds");
    expect(p.goal).toMatch(/workspace videos\//);
  });

  it("weaves live follow-up /video while leaving plain text alone", () => {
    expect(weaveFollowUpComposerGoal({ goalText: "next step" })).toBe(
      "next step",
    );
    const woven = weaveFollowUpComposerGoal({
      goalText: "/video hero clip",
      mediaStudio: { kind: "video", durationSec: 8, aspectRatio: "3:4" },
    });
    expect(woven).toContain("/video hero clip");
    expect(woven).toContain("Duration: 8 seconds");
    expect(woven).toMatch(/workspace videos\//);
  });

  it("includes follow-up mutation and revision ids only when supplied", () => {
    const base = buildOptimisticTask({
      ...form,
      id: "parent-1",
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    const common = {
      goalText: "next step",
      base,
      composerRoot: "/ignored",
      fallbackModel: "fallback",
      fallbackEffort: "heavy" as const,
      fallbackApprovalMode: "strict" as const,
    };

    expect(buildFollowUpTaskParams(common)).not.toHaveProperty(
      "clientMutationId",
    );
    expect(buildFollowUpTaskParams(common)).not.toHaveProperty(
      "revisionOfTaskId",
    );
    expect(
      buildFollowUpTaskParams({
        ...common,
        clientMutationId: "queue-item-1",
        revisionOfTaskId: "task-revision-1",
      }),
    ).toMatchObject({
      clientMutationId: "queue-item-1",
      revisionOfTaskId: "task-revision-1",
    });
  });

  it("canFollowUpOnTask rejects optimistic placeholders", () => {
    const opt = buildOptimisticTask({
      ...form,
      id: "optimistic-x",
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    expect(canFollowUpOnTask(opt)).toBe(false);
    expect(canFollowUpOnTask({ ...opt, id: "real" })).toBe(true);
    expect(canFollowUpOnTask(null)).toBe(false);
  });
});
