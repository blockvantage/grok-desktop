import { describe, expect, it } from "vitest";
import {
  foldRecoveredWorkEntries,
  projectWorkGraph,
  stageHintFromEvent,
  stagesFromEvents,
  WORK_GRAPH_STAGES,
} from "./work-graph";

describe("work-graph stage mapping", () => {
  it("maps plan_update to plan", () => {
    expect(
      stageHintFromEvent({
        kind: "plan_update",
        payload: { content: "1. research 2. edit" },
      }),
    ).toBe("plan");
  });

  it("maps research tools and citations", () => {
    expect(
      stageHintFromEvent({
        kind: "tool_request",
        payload: { tool: "web_search" },
      }),
    ).toBe("research");
    expect(
      stageHintFromEvent({
        kind: "citations",
        payload: { items: [] },
      }),
    ).toBe("research");
  });

  it("maps edit tools", () => {
    expect(
      stageHintFromEvent({
        kind: "tool_request",
        payload: { tool: "write_file" },
      }),
    ).toBe("edit");
  });

  it("maps review signals", () => {
    expect(
      stageHintFromEvent({
        kind: "step",
        payload: { title: "Reviewing changes" },
      }),
    ).toBe("review");
    expect(
      stageHintFromEvent({
        kind: "approval_required",
        payload: { planReview: true, reason: "Approve plan" },
      }),
    ).toBe("review");
  });

  it("maps deliver signals", () => {
    expect(
      stageHintFromEvent({
        kind: "artifact_created",
        payload: { id: "a1", kind: "file" },
      }),
    ).toBe("deliver");
  });

  it("does not invent a stage for generic unknown tools", () => {
    expect(
      stageHintFromEvent({
        kind: "tool_request",
        payload: { tool: "unknown_gadget" },
      }),
    ).toBeNull();
  });

  it("projects one current stage with elapsed and status across a full sequence", () => {
    const startedAt = "2026-07-31T12:00:00.000Z";
    const events = [
      { kind: "plan_update", payload: { content: "plan" }, createdAt: startedAt },
      {
        kind: "tool_request",
        payload: { tool: "web_search" },
        createdAt: "2026-07-31T12:01:00.000Z",
      },
      {
        kind: "tool_request",
        payload: { tool: "write_file" },
        createdAt: "2026-07-31T12:02:00.000Z",
      },
      {
        kind: "step",
        payload: { title: "Reviewing the patch" },
        createdAt: "2026-07-31T12:03:00.000Z",
      },
      {
        kind: "artifact_created",
        payload: { id: "a1", kind: "file", title: "out.md" },
        createdAt: "2026-07-31T12:04:00.000Z",
      },
    ];
    const view = projectWorkGraph({
      events,
      task: { status: "running", createdAt: startedAt },
    });
    expect(view.stagesReached).toEqual([
      "plan",
      "research",
      "edit",
      "review",
      "deliver",
    ]);
    expect(view.currentStage).toBe("deliver");
    expect(view.elapsedStartIso).toBe(startedAt);
    expect(view.productState).toBe("working");
    expect(view.statusText.length).toBeGreaterThan(0);
    expect(view.needsYou).toBe(false);
    // Canonical order matches exported stages list.
    expect(WORK_GRAPH_STAGES).toEqual([
      "plan",
      "research",
      "edit",
      "review",
      "deliver",
    ]);
  });

  it("surfaces waiting_for_approval distinctly from failure", () => {
    const approval = projectWorkGraph({
      events: [
        {
          kind: "approval_required",
          payload: {
            approvalId: "ap-1",
            reason: "Allow shell command",
          },
        },
      ],
      task: { status: "waiting_approval", createdAt: "2026-07-31T12:00:00.000Z" },
    });
    expect(approval.productState).toBe("waiting_for_approval");
    expect(approval.needsYou).toBe(true);
    expect(approval.requiredAction).toContain("Allow shell");
    expect(approval.statusText.toLowerCase()).not.toMatch(/fail/);

    const failed = projectWorkGraph({
      events: [
        {
          kind: "error",
          payload: { message: "Engine crashed" },
        },
      ],
      task: { status: "failed", createdAt: "2026-07-31T12:00:00.000Z" },
    });
    expect(failed.productState).toBe("failed");
    expect(failed.needsYou).toBe(false);
  });

  it("surfaces retrying and recovered product states from status signals", () => {
    const retrying = projectWorkGraph({
      events: [
        { kind: "error", payload: { message: "lease lost" } },
        {
          kind: "status_change",
          payload: { status: "running", reason: "retry attempt 2" },
        },
      ],
      task: { status: "running", createdAt: "2026-07-31T12:00:00.000Z" },
    });
    expect(retrying.productState).toBe("retrying");

    const recovered = projectWorkGraph({
      events: [
        { kind: "error", payload: { message: "process died" } },
        {
          kind: "status_change",
          payload: { status: "running", reason: "crash recovery" },
        },
      ],
      task: { status: "running", createdAt: "2026-07-31T12:00:00.000Z" },
    });
    expect(recovered.productState).toBe("recovered");
  });

  it("maps worker events into stage updates when labels support it", () => {
    const { currentStage, stagesReached } = stagesFromEvents([
      {
        kind: "worker_started",
        payload: { workerId: "w1", label: "Research helper" },
      },
      {
        kind: "worker_activity",
        payload: {
          workerId: "w1",
          summary: "Reading docs",
        },
      },
    ]);
    expect(stagesReached).toContain("research");
    expect(currentStage).toBe("research");
  });
});

describe("foldRecoveredWorkEntries", () => {
  it("marks pre-recovery failures as diagnostic when the run continued", () => {
    const entries = [
      {
        kind: "error",
        timestamp: "2026-07-31T12:00:00.000Z",
        diagnostic: false,
        payload: { message: "lease expired" },
      },
      {
        kind: "status_change",
        timestamp: "2026-07-31T12:00:01.000Z",
        diagnostic: false,
        payload: { status: "failed" },
      },
      {
        kind: "status_change",
        timestamp: "2026-07-31T12:00:02.000Z",
        diagnostic: false,
        payload: { status: "running", reason: "recovered" },
      },
      {
        kind: "step",
        timestamp: "2026-07-31T12:00:03.000Z",
        diagnostic: false,
        payload: { title: "Continuing work" },
      },
    ];
    const folded = foldRecoveredWorkEntries(entries, "running");
    expect(folded[0]!.diagnostic).toBe(true);
    expect(folded[1]!.diagnostic).toBe(true);
    // Post-recovery rows stay primary.
    expect(folded[2]!.diagnostic).toBe(false);
    expect(folded[3]!.diagnostic).toBe(false);
  });

  it("keeps failures visible when the task is still failed", () => {
    const entries = [
      {
        kind: "error",
        timestamp: "2026-07-31T12:00:00.000Z",
        diagnostic: false,
        payload: { message: "fatal" },
      },
    ];
    const folded = foldRecoveredWorkEntries(entries, "failed");
    expect(folded[0]!.diagnostic).toBe(false);
  });
});
