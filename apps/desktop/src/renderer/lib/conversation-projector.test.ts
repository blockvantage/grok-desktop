import type { Artifact, Task, TaskEvent } from "@grokdesk/shared";
import { describe, expect, it } from "vitest";
import type { DurableQueuedMessage } from "./message-queue-store";
import {
  isOperationalNarration,
  isProviderNoise,
  mergeRunState,
  mergeWorker,
  projectConversation,
  type ConversationProjectionInput,
} from "./conversation-projector";

it("treats drafting updates as live narration", () => {
  expect(isOperationalNarration("I’m drafting a focused brief now.")).toBe(
    true,
  );
});

function task(
  id: string,
  status: Task["status"],
  createdAt: string,
  revisionOfTaskId: string | null = null,
): Task {
  return {
    id,
    goal: `Goal ${id}`,
    title: null,
    mode: "interactive",
    status,
    model: "grok",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: [],
      allowNetworkTools: true,
      allowShell: true,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId,
    attachments: [],
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt,
    updatedAt: createdAt,
    completedAt: status === "done" ? createdAt : null,
  };
}

function event(
  id: string,
  taskId: string,
  seq: number,
  kind: TaskEvent["kind"],
  payload: Record<string, unknown>,
  createdAt = `2026-01-01T00:00:0${seq}.000Z`,
): TaskEvent {
  return { id, taskId, seq, kind, payload, createdAt };
}

function queued(
  id: string,
  conversationId: string,
  status: DurableQueuedMessage["status"],
): DurableQueuedMessage {
  return {
    id,
    conversationId,
    text: `Queued ${id}`,
    createdAt: `2026-01-01T00:01:0${id.at(-1)}.000Z`,
    status,
    clientMutationId: id,
    claimedAt: status === "submitting" ? "2026-01-01T00:02:00.000Z" : null,
  };
}

describe("projectConversation", () => {
  it("shows an attachment recovery failure on its turn instead of queued activity", () => {
    const failed = task(
      "attachment-failed",
      "failed",
      "2026-01-01T00:00:00.000Z",
    );
    const message =
      "The accepted attachment is no longer available. Edit this message and attach the file again.";
    const snapshot = projectConversation({
      conversationId: failed.id,
      title: null,
      tasks: [failed],
      eventsByTask: {
        [failed.id]: [
          event("attachment-error", failed.id, 1, "error", {
            code: "attachment_recovery_failed",
            message,
            recoverable: true,
          }),
          event("attachment-status", failed.id, 2, "status_change", {
            status: "failed",
          }),
        ],
      },
    });

    expect(snapshot.turns[0]).toMatchObject({
      state: "failed",
      error: { message },
    });
    expect(snapshot.activeTurnId).toBeNull();
  });

  it("keeps the remaining keyed approval actionable without reviving terminal turns", () => {
    const active = task("approval-active", "running", "2026-01-01T00:00:00.000Z");
    const events = [
      event("required-a", active.id, 1, "approval_required", {
        approvalId: "a",
        reason: "Approve A",
      }),
      event("required-b", active.id, 2, "approval_required", {
        approvalId: "b",
        reason: "Approve B",
      }),
      event("resolved-a", active.id, 3, "approval_resolved", {
        approvalId: "a",
        decision: "approve",
      }),
      event("running-after-a", active.id, 4, "status_change", {
        status: "running",
      }),
    ];
    const activeSnapshot = projectConversation({
      conversationId: active.id,
      title: null,
      tasks: [active],
      eventsByTask: { [active.id]: events },
    });
    expect(activeSnapshot.turns[0]).toMatchObject({
      state: "waiting_approval",
      approval: { approvalId: "b" },
    });
    expect(activeSnapshot.needsUserAction).toBe(true);

    const terminal = { ...active, status: "done" as const, completedAt: active.updatedAt };
    const terminalSnapshot = projectConversation({
      conversationId: terminal.id,
      title: null,
      tasks: [terminal],
      eventsByTask: { [terminal.id]: events },
    });
    expect(terminalSnapshot.turns[0]).toMatchObject({
      state: "done",
      approval: { approvalId: "b" },
    });
    expect(terminalSnapshot.needsUserAction).toBe(false);
  });

  it("contains worker failure while primary waits for approval and coalesces browser work", () => {
    const primary = task(
      "mixed-turn",
      "waiting_approval",
      "2026-01-01T00:00:00.000Z",
    );
    const report: Artifact = {
      id: "report",
      taskId: primary.id,
      title: "Report",
      kind: "report",
      path: "/tmp/report.md",
      mimeType: "text/markdown",
      createdAt: "2026-01-01T00:00:08.000Z",
    };
    const snapshot = projectConversation({
      conversationId: primary.id,
      title: "Mixed work",
      tasks: [primary],
      eventsByTask: {
        [primary.id]: [
          event("worker-a-start", primary.id, 1, "worker_started", {
            workerId: "worker-a",
            label: "Research",
          }),
          event("worker-b-start", primary.id, 2, "worker_started", {
            workerId: "worker-b",
            label: "Checks",
          }),
          event("worker-a-done", primary.id, 3, "worker_completed", {
            workerId: "worker-a",
            summary: "Research ready",
          }),
          event("browser-request", primary.id, 4, "tool_request", {
            id: "browser-call",
            tool: "browser_open",
            url: "https://example.com",
          }),
          event("browser-result", primary.id, 5, "tool_result", {
            id: "browser-call",
            tool: "browser_open",
            ok: true,
            browserProvider: "desk-browser",
          }),
          event("worker-b-error", primary.id, 6, "error", {
            workerId: "worker-b",
            message: "Connector unavailable",
          }),
          event("worker-b-failed", primary.id, 7, "worker_failed", {
            workerId: "worker-b",
            summary: "Connector unavailable",
          }),
          event("artifact", primary.id, 8, "artifact_created", {
            // Event IDs and durable artifact row IDs are intentionally
            // different; the projector must reconcile them by file path.
            id: "event-report-id",
            title: report.title,
            kind: report.kind,
            path: report.path,
          }),
          event("approval", primary.id, 9, "approval_required", {
            approvalId: "approval-1",
            reason: "Publish the report?",
          }),
        ],
      },
      artifactsByTask: { [primary.id]: [report] },
    });

    const turn = snapshot.turns[0]!;
    expect(turn.state).toBe("waiting_approval");
    expect(turn.error).toBeNull();
    expect(turn.workers["worker-a"]?.status).toBe("done");
    expect(turn.workers["worker-b"]?.status).toBe("failed");
    expect(turn.approval?.approvalId).toBe("approval-1");
    expect(turn.artifacts).toEqual([report]);
    expect(
      turn.work.filter((entry) => entry.payload.tool === "browser_open"),
    ).toHaveLength(1);
    expect(
      turn.work.find((entry) => entry.id === "worker-b-error")?.diagnostic,
    ).toBe(true);
  });

  it("derives a recoverable turn error only from a failed primary task", () => {
    const completed = task("completed", "done", "2026-01-01T00:00:00.000Z");
    const failed = task("failed", "failed", "2026-01-01T00:01:00.000Z");
    const snapshot = projectConversation({
      conversationId: "conversation",
      title: null,
      tasks: [completed, failed],
      eventsByTask: {
        completed: [
          event("completed-error", completed.id, 1, "error", {
            message: "Recovered transient error",
          }),
          event("completed-answer", completed.id, 2, "message", {
            role: "assistant",
            channel: "text",
            text: "Finished answer",
          }),
        ],
        failed: [
          event("failed-error", failed.id, 1, "error", {
            message: "Authentication expired",
          }),
        ],
      },
    });

    expect(snapshot.turns[0]?.answer?.text).toBe("Finished answer");
    expect(snapshot.turns[0]?.error).toBeNull();
    expect(snapshot.turns[1]?.error?.message).toBe("Authentication expired");
  });

  it("keeps operational narration as live progress without replacing the answer", () => {
    const active = task("progress-answer", "running", "2026-01-01T00:00:00.000Z");
    const snapshot = projectConversation({
      conversationId: active.id,
      title: null,
      tasks: [active],
      eventsByTask: {
        [active.id]: [
          event("answer", active.id, 1, "message", {
            role: "assistant",
            channel: "text",
            text: "The settings are valid.",
          }),
          event("progress", active.id, 2, "message", {
            role: "assistant",
            channel: "text",
            text: "I’ll check the remaining files now.",
          }),
        ],
      },
    });

    expect(snapshot.turns[0]?.answer?.text).toBe("The settings are valid.");
    expect(snapshot.turns[0]?.liveSummary).toBe(
      "I’ll check the remaining files now.",
    );
  });

  it("promotes the only safe narration message when the turn is terminal", () => {
    const completed = task("short-final", "done", "2026-01-01T00:00:00.000Z");
    const snapshot = projectConversation({
      conversationId: completed.id,
      title: null,
      tasks: [completed],
      eventsByTask: {
        [completed.id]: [
          event("short-final-answer", completed.id, 1, "message", {
            role: "assistant",
            channel: "text",
            text: "I’ll explain the tradeoffs directly.",
          }),
        ],
      },
    });

    expect(snapshot.turns[0]?.answer?.text).toBe(
      "I’ll explain the tradeoffs directly.",
    );
    expect(snapshot.turns[0]?.liveSummary).toBeNull();
  });

  it("preserves answer paragraphs separated by citation metadata", () => {
    const completed = task("multi-part", "done", "2026-01-01T00:00:00.000Z");
    const snapshot = projectConversation({
      conversationId: completed.id,
      title: null,
      tasks: [completed],
      eventsByTask: {
        [completed.id]: [
          event("part-one", completed.id, 1, "message", {
            role: "assistant",
            channel: "text",
            text: "The first finding is confirmed.",
          }),
          event("sources", completed.id, 2, "citations", {
            items: [{ url: "https://example.com/source" }],
          }),
          event("part-two", completed.id, 3, "message", {
            role: "assistant",
            channel: "text",
            text: "The second finding needs follow-up.",
          }),
        ],
      },
    });

    expect(snapshot.turns[0]?.answer?.text).toBe(
      "The first finding is confirmed.\n\nThe second finding needs follow-up.",
    );
  });

  it("keeps a substantive answer instead of replacing it with a terminal summary", () => {
    const completed = task("answer-summary", "done", "2026-01-01T00:00:00.000Z");
    const answer =
      "Your launch brief is ready. Review the [linked source](https://example.com/source).";
    const snapshot = projectConversation({
      conversationId: completed.id,
      title: null,
      tasks: [completed],
      eventsByTask: {
        [completed.id]: [
          event("answer", completed.id, 1, "message", {
            role: "assistant",
            channel: "text",
            text: answer,
          }),
          event("summary", completed.id, 2, "message", {
            role: "assistant",
            channel: "text",
            terminal: true,
            text: "Launch brief ready — saved to your workspace.",
          }),
        ],
      },
    });

    expect(snapshot.turns[0]?.answer?.text).toBe(answer);
  });

  it("quarantines stored protocol envelopes from the answer", () => {
    const completed = task("protocol-noise", "done", "2026-01-01T00:00:00.000Z");
    const snapshot = projectConversation({
      conversationId: completed.id,
      title: null,
      tasks: [completed],
      eventsByTask: {
        [completed.id]: [
          event("protocol", completed.id, 1, "message", {
            role: "assistant",
            channel: "text",
            text: JSON.stringify({
              type: "tool_call_update",
              content: [{ type: "image", data: "A".repeat(4_096) }],
            }),
          }),
        ],
      },
    });

    expect(snapshot.turns[0]?.answer).toBeNull();
  });

  it("projects one isolated turn and primary run per accepted task", () => {
    const t1 = task("task-1", "done", "2026-01-01T00:00:00.000Z");
    const t2 = task(
      "task-2",
      "waiting_approval",
      "2026-01-01T00:10:00.000Z",
      "task-1",
    );
    const artifact1: Artifact = {
      id: "artifact-1",
      taskId: t1.id,
      title: "Report",
      kind: "report",
      path: "/tmp/report.md",
      mimeType: "text/markdown",
      createdAt: "2026-01-01T00:00:08.000Z",
    };
    const input: ConversationProjectionInput = {
      conversationId: "conversation-1",
      title: "Canonical conversation",
      tasks: [t2, t1],
      eventsByTask: {
        [t1.id]: [
          event("t1-user", t1.id, 1, "message", {
            role: "user",
            text: "Do it",
            channel: "text",
          }),
          event("t1-worker-start", t1.id, 2, "worker_started", {
            workerId: "worker-a",
            label: "Research",
            objective: "Find sources",
          }),
          event("t1-thought", t1.id, 3, "message", {
            role: "assistant",
            text: "I should inspect the sources",
            channel: "thought",
          }),
          event("t1-noise", t1.id, 4, "step", {
            title: "Grok Build session",
            status: "start",
          }),
          event("t1-worker-done", t1.id, 5, "worker_completed", {
            workerId: "worker-a",
            summary: "Found three sources",
          }),
          event("t1-worker-duplicate", t1.id, 6, "worker_started", {
            workerId: "worker-a",
            label: "Research",
          }),
          event("t1-answer", t1.id, 7, "message", {
            role: "assistant",
            text: "The final answer",
            channel: "text",
          }),
          event("t1-artifact", t1.id, 8, "artifact_created", {
            id: artifact1.id,
            title: artifact1.title,
            path: artifact1.path,
            kind: artifact1.kind,
          }),
        ],
        [t2.id]: [
          event("t2-user", t2.id, 1, "message", {
            role: "user",
            text: "Revise it",
            channel: "text",
          }),
          event("t2-approval", t2.id, 2, "approval_required", {
            approvalId: "approval-task-2",
            reason: "Allow shell?",
          }),
          event("t2-error", t2.id, 3, "error", {
            message: "Only task two failed here",
          }),
        ],
      },
      artifactsByTask: { [t1.id]: [artifact1], [t2.id]: [] },
      queued: [
        queued("queue-1", "conversation-1", "pending"),
        queued("queue-2", "conversation-1", "submitting"),
        queued("queue-3", "conversation-1", "failed"),
        queued("queue-other", "conversation-2", "pending"),
      ],
    };

    const snapshot = projectConversation(input);

    expect(snapshot.turns).toHaveLength(2);
    expect(snapshot.turns.map((turn) => turn.taskId)).toEqual([t1.id, t2.id]);
    expect(
      snapshot.turns.every((turn) => turn.primaryRun.id === turn.taskId),
    ).toBe(true);
    expect(snapshot.turns[0]?.workers).toEqual({
      "worker-a": expect.objectContaining({
        id: "worker-a",
        status: "done",
        result: "Found three sources",
      }),
    });
    expect(snapshot.turns[0]?.answer?.text).toBe("The final answer");
    expect(snapshot.turns[0]?.work.map((entry) => entry.summary)).toEqual(
      expect.arrayContaining([
        "I should inspect the sources",
        "Grok Build session",
      ]),
    );
    expect(
      snapshot.turns[0]?.work.find((entry) => entry.id === "t1-noise")
        ?.diagnostic,
    ).toBe(true);
    expect(snapshot.turns[0]?.artifacts).toEqual([artifact1]);
    expect(snapshot.turns[0]?.approval).toBeNull();
    expect(snapshot.turns[0]?.error).toBeNull();
    expect(snapshot.turns[1]?.approval?.summary).toBe("Allow shell?");
    expect(snapshot.turns[1]?.error).toBeNull();
    expect(
      snapshot.turns[1]?.work.find((entry) => entry.id === "t2-error")
        ?.summary,
    ).toBe("Only task two failed here");
    expect(snapshot.turns[1]?.artifacts).toEqual([]);
    expect(snapshot.turns[1]?.revisionOfTurnId).toBe("task-1");
    expect(snapshot.queued.map((item) => item.id)).toEqual([
      "queue-1",
      "queue-2",
      "queue-3",
    ]);
    expect(snapshot.activeTurnId).toBe("task-2");
    expect(snapshot.needsUserAction).toBe(true);
  });

  it("is semantically identical across event and task arrival permutations", () => {
    const primary = task("primary", "done", "2026-01-01T00:00:00.000Z");
    const followup = task("followup", "running", "2026-01-01T00:10:00.000Z");
    const events = [
      event("start-b", followup.id, 2, "worker_started", {
        workerId: "worker-b",
        label: "Writer",
      }),
      event("activity-a", followup.id, 4, "worker_activity", {
        workerId: "worker-a",
        summary: "Late progress",
      }),
      event("done-a", followup.id, 3, "worker_completed", {
        workerId: "worker-a",
        summary: "Research result",
      }),
      event("start-a", followup.id, 1, "worker_started", {
        workerId: "worker-a",
        label: "Researcher",
      }),
      event("answer", followup.id, 5, "message", {
        role: "assistant",
        text: "Stable answer",
        channel: "text",
      }),
      event("late-step", followup.id, 6, "step", {
        title: "Late progress",
        status: "start",
      }),
    ];
    const base = {
      conversationId: primary.id,
      title: null,
      artifactsByTask: {},
      queued: [],
    };
    const snapshots = [
      projectConversation({
        ...base,
        tasks: [primary, followup],
        eventsByTask: { primary: [], followup: events },
      }),
      projectConversation({
        ...base,
        tasks: [followup, primary],
        eventsByTask: { followup: [...events].reverse(), primary: [] },
      }),
      projectConversation({
        ...base,
        tasks: [followup, primary],
        eventsByTask: {
          followup: [
            events[3]!,
            events[4]!,
            events[1]!,
            events[0]!,
            events[5]!,
            events[2]!,
          ],
          primary: [],
        },
      }),
    ];

    expect(snapshots[1]).toEqual(snapshots[0]);
    expect(snapshots[2]).toEqual(snapshots[0]);
    const turn = snapshots[0]?.turns[1];
    expect(turn?.workers["worker-a"]).toEqual(
      expect.objectContaining({
        status: "done",
        currentActivity: null,
        result: "Research result",
      }),
    );
    expect(turn?.answer?.text).toBe("Stable answer");
  });

  it("marks a revised source as superseded while keeping both turns", () => {
    const source = task("source", "done", "2026-01-01T00:00:00.000Z");
    const revision = task(
      "revision",
      "running",
      "2026-01-01T00:01:00.000Z",
      source.id,
    );

    const snapshot = projectConversation({
      conversationId: "source",
      title: null,
      tasks: [revision, source],
      eventsByTask: {},
      attachmentsByTask: {
        [source.id]: [
          {
            id: "attachment-1",
            name: "brief.pdf",
            sourcePath: "/tmp/brief.pdf",
            kind: "file",
          },
        ],
      },
    });

    expect(snapshot.turns.map((turn) => turn.taskId)).toEqual([
      "source",
      "revision",
    ]);
    expect(snapshot.turns[0]).toMatchObject({
      superseded: true,
      revisionOfTurnId: null,
      attachments: [{ id: "attachment-1", name: "brief.pdf" }],
    });
    expect(snapshot.turns[1]).toMatchObject({
      superseded: false,
      revisionOfTurnId: "source",
    });
  });

  it("keeps eventsByTask isolated even when an event claims another taskId", () => {
    const t1 = task("task-1", "done", "2026-01-01T00:00:00.000Z");
    const t2 = task("task-2", "done", "2026-01-01T00:10:00.000Z");
    const snapshot = projectConversation({
      conversationId: "conversation",
      title: null,
      tasks: [t1, t2],
      eventsByTask: {
        [t1.id]: [
          event("answer-1", t2.id, 1, "message", {
            role: "assistant",
            text: "Stored under task one",
            channel: "text",
          }),
        ],
        [t2.id]: [],
      },
      artifactsByTask: {},
      queued: [],
    });

    expect(snapshot.turns[0]?.answer?.text).toBe("Stored under task one");
    expect(snapshot.turns[1]?.answer).toBeNull();
  });

  it("orders equal-timestamp turns by stable task id so live/latest agree", () => {
    const terminal = task("task-a", "done", "2026-01-01T00:10:00.000Z");
    const live = task("task-z", "running", "2026-01-01T00:10:00.000Z");
    const snapshot = projectConversation({
      conversationId: "conversation",
      title: null,
      tasks: [live, terminal],
      eventsByTask: {},
    });

    expect(snapshot.turns.map((turn) => turn.taskId)).toEqual([
      "task-a",
      "task-z",
    ]);
    expect(snapshot.activeTurnId).toBe("task-z");
  });

  it("preserves legacy unknown attachments separately from exact empty", () => {
    const legacy = task("legacy", "done", "2026-01-01T00:00:00.000Z");
    legacy.attachments = null;
    const exact = task("exact", "done", "2026-01-01T00:01:00.000Z");
    exact.attachments = [];

    const snapshot = projectConversation({
      conversationId: "conversation",
      title: null,
      tasks: [legacy, exact],
      eventsByTask: {},
    });

    expect(snapshot.turns.find((turn) => turn.taskId === "legacy")).toMatchObject({
      attachments: [],
      attachmentsKnown: false,
    });
    expect(snapshot.turns.find((turn) => turn.taskId === "exact")).toMatchObject({
      attachments: [],
      attachmentsKnown: true,
    });
  });

  it("merges task and event run states through one monotonic precedence", () => {
    const terminalTask = task(
      "terminal-task",
      "done",
      "2026-01-01T00:00:00.000Z",
    );
    const activeTask = task(
      "active-task",
      "running",
      "2026-01-01T00:10:00.000Z",
    );
    const terminalEvents = [
      event("status-running", terminalTask.id, 1, "status_change", {
        status: "running",
      }),
      event("status-failed", terminalTask.id, 2, "status_change", {
        status: "failed",
      }),
    ];
    const waitingEvent = event(
      "status-waiting",
      activeTask.id,
      1,
      "status_change",
      { status: "waiting_approval" },
      "2026-01-01T00:11:00.000Z",
    );
    const project = (terminalOrder: TaskEvent[]) =>
      projectConversation({
        conversationId: "conversation",
        title: null,
        tasks: [activeTask, terminalTask],
        eventsByTask: {
          [terminalTask.id]: terminalOrder,
          [activeTask.id]: [waitingEvent],
        },
      });
    const swapTaskAndEventStates = projectConversation({
      conversationId: "conversation",
      title: null,
      tasks: [
        { ...terminalTask, status: "failed" },
        { ...activeTask, status: "waiting_approval" },
      ],
      eventsByTask: {
        [terminalTask.id]: [
          event("status-done", terminalTask.id, 1, "status_change", {
            status: "done",
          }),
        ],
        [activeTask.id]: [
          event("status-running", activeTask.id, 1, "status_change", {
            status: "running",
          }),
        ],
      },
    });

    const forward = project(terminalEvents);
    const reverse = project([...terminalEvents].reverse());

    expect(reverse).toEqual(forward);
    expect(forward.turns.find((turn) => turn.id === terminalTask.id)?.state).toBe(
      "failed",
    );
    expect(forward.turns.find((turn) => turn.id === activeTask.id)?.state).toBe(
      "waiting_approval",
    );
    expect(
      swapTaskAndEventStates.turns.map((turn) => [turn.id, turn.state]),
    ).toEqual(forward.turns.map((turn) => [turn.id, turn.state]));
  });

  it("uses stable event identity to break equal time and sequence ties", () => {
    const t1 = task("task-1", "done", "2026-01-01T00:00:00.000Z");
    const timestamp = "2026-01-01T00:01:00.000Z";
    const tiedEvents = [
      event(
        "answer-a",
        t1.id,
        1,
        "message",
        { role: "assistant", text: "Answer A", channel: "text" },
        timestamp,
      ),
      event(
        "answer-z",
        t1.id,
        1,
        "message",
        { role: "assistant", text: "Answer Z", channel: "text" },
        timestamp,
      ),
      event(
        "user-message",
        t1.id,
        1,
        "message",
        { role: "user", text: "Do it", channel: "text" },
        timestamp,
      ),
      event(
        "thought",
        t1.id,
        1,
        "message",
        { role: "assistant", text: "Inspect first", channel: "thought" },
        timestamp,
      ),
      event(
        "tool",
        t1.id,
        1,
        "tool_request",
        { id: "tool-call", tool: "browser_open" },
        timestamp,
      ),
    ];
    const project = (events: TaskEvent[]) =>
      projectConversation({
        conversationId: "conversation",
        title: null,
        tasks: [t1],
        eventsByTask: { [t1.id]: events },
      });

    const forward = project(tiedEvents);
    const reverse = project([...tiedEvents].reverse());

    expect(reverse).toEqual(forward);
    expect(forward.turns[0]?.answer?.eventId).toBe("answer-z");
    expect(forward.turns[0]?.answer?.text).toBe("Answer Z");
    expect(forward.turns[0]?.work.map((entry) => entry.id)).not.toContain(
      "answer-a",
    );
    expect(forward.turns[0]?.work.map((entry) => entry.id)).not.toContain(
      "answer-z",
    );
    expect(forward.turns[0]?.work.map((entry) => entry.id)).not.toContain(
      "user-message",
    );
    expect(forward.turns[0]?.work.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["thought", "tool"]),
    );
  });

  it("clears resolved nonterminal user-action states chronologically", () => {
    const approvalTask = task(
      "approval-task",
      "running",
      "2026-01-01T00:00:00.000Z",
    );
    approvalTask.updatedAt = "2026-01-01T00:00:00.000Z";
    const userTask = task(
      "user-task",
      "running",
      "2026-01-01T00:10:00.000Z",
    );
    userTask.updatedAt = "2026-01-01T00:10:00.000Z";
    const rowAuthorityTask = task(
      "row-authority-task",
      "running",
      "2026-01-01T00:20:00.000Z",
    );
    rowAuthorityTask.updatedAt = "2026-01-01T00:22:00.000Z";
    const snapshot = projectConversation({
      conversationId: "conversation",
      title: null,
      tasks: [rowAuthorityTask, userTask, approvalTask],
      eventsByTask: {
        [approvalTask.id]: [
          event(
            "approval-required",
            approvalTask.id,
            1,
            "approval_required",
            { approvalId: "approval-shell", reason: "Allow shell?" },
            "2026-01-01T00:01:00.000Z",
          ),
          event(
            "approval-waiting",
            approvalTask.id,
            2,
            "status_change",
            { status: "waiting_approval" },
            "2026-01-01T00:02:00.000Z",
          ),
          event(
            "approval-resolved",
            approvalTask.id,
            3,
            "approval_resolved",
            { approvalId: "approval-shell", decision: "approved" },
            "2026-01-01T00:03:00.000Z",
          ),
          event(
            "approval-running",
            approvalTask.id,
            4,
            "status_change",
            { status: "running" },
            "2026-01-01T00:04:00.000Z",
          ),
        ],
        [userTask.id]: [
          event(
            "user-waiting",
            userTask.id,
            1,
            "status_change",
            { status: "waiting_user" },
            "2026-01-01T00:11:00.000Z",
          ),
          event(
            "user-running",
            userTask.id,
            2,
            "status_change",
            { status: "running" },
            "2026-01-01T00:12:00.000Z",
          ),
        ],
        [rowAuthorityTask.id]: [
          event(
            "row-older-waiting",
            rowAuthorityTask.id,
            1,
            "status_change",
            { status: "waiting_user" },
            "2026-01-01T00:21:00.000Z",
          ),
        ],
      },
    });

    expect(snapshot.turns.map((turn) => turn.state)).toEqual([
      "running",
      "running",
      "running",
    ]);
    expect(snapshot.turns[0]?.approval).toBeNull();
    expect(snapshot.needsUserAction).toBe(false);
  });

  it("retains provider-noise assistant text only as diagnostic work", () => {
    const t1 = task("task-1", "done", "2026-01-01T00:00:00.000Z");
    const snapshot = projectConversation({
      conversationId: "conversation",
      title: null,
      tasks: [t1],
      eventsByTask: {
        [t1.id]: [
          event("noise-build", t1.id, 1, "message", {
            role: "assistant",
            text: "Grok Build session",
            channel: "text",
          }),
          event("noise-ready", t1.id, 2, "message", {
            role: "assistant",
            text: "Session ready — initializing",
            channel: "text",
          }),
        ],
      },
    });

    expect(snapshot.turns[0]?.answer).toBeNull();
    expect(snapshot.turns[0]?.work).toEqual([
      expect.objectContaining({
        id: "noise-build",
        summary: "Grok Build session",
        diagnostic: true,
      }),
      expect.objectContaining({
        id: "noise-ready",
        summary: "Session ready — initializing",
        diagnostic: true,
      }),
    ]);
  });

  it("coalesces duplicate event IDs deterministically before projection", () => {
    const t1 = task("task-1", "running", "2026-01-01T00:00:00.000Z");
    const timestamp = "2026-01-01T00:01:00.000Z";
    const exactThought = event(
      "thought",
      t1.id,
      1,
      "message",
      { role: "assistant", text: "Inspect", channel: "thought" },
      timestamp,
    );
    const conflictingEvents = [
      event(
        "answer",
        t1.id,
        2,
        "message",
        { role: "assistant", text: "Short", channel: "text" },
        timestamp,
      ),
      event(
        "answer",
        t1.id,
        2,
        "message",
        {
          role: "assistant",
          text: "Richer deterministic final answer",
          channel: "text",
        },
        timestamp,
      ),
      event(
        "worker",
        t1.id,
        3,
        "worker_started",
        { workerId: "worker-1", label: "R" },
        timestamp,
      ),
      event(
        "worker",
        t1.id,
        3,
        "worker_started",
        {
          workerId: "worker-1",
          label: "Research specialist",
          objective: "Inspect all sources",
        },
        timestamp,
      ),
      event(
        "approval",
        t1.id,
        4,
        "approval_required",
        { approvalId: "approval-1", reason: "Allow?" },
        timestamp,
      ),
      event(
        "approval",
        t1.id,
        4,
        "approval_required",
        {
          approvalId: "approval-1",
          reason: "Allow the inspected shell command?",
        },
        timestamp,
      ),
      exactThought,
      {
        ...exactThought,
        payload: { channel: "thought", text: "Inspect", role: "assistant" },
      },
    ];
    const project = (events: TaskEvent[]) =>
      projectConversation({
        conversationId: "conversation",
        title: null,
        tasks: [t1],
        eventsByTask: { [t1.id]: events },
      });

    const forward = project(conflictingEvents);
    const reverse = project([...conflictingEvents].reverse());

    expect(reverse).toEqual(forward);
    expect(forward.turns[0]?.answer?.text).toBe(
      "Richer deterministic final answer",
    );
    expect(forward.turns[0]?.workers["worker-1"]).toEqual(
      expect.objectContaining({
        label: "Research specialist",
        objective: "Inspect all sources",
      }),
    );
    expect(forward.turns[0]?.approval).toEqual(
      expect.objectContaining({
        approvalId: "approval-1",
        summary: "Allow the inspected shell command?",
      }),
    );
    expect(forward.turns[0]?.work.filter((entry) => entry.id === "thought"))
      .toHaveLength(1);
    expect(forward.turns[0]?.work.filter((entry) => entry.id === "worker"))
      .toHaveLength(1);
    expect(forward.turns[0]?.work.filter((entry) => entry.id === "approval"))
      .toHaveLength(1);
  });

  it("resolves approvals by approvalId without clearing unrelated pending", () => {
    const t1 = task("task-1", "running", "2026-01-01T00:00:00.000Z");
    const approvals = [
      event("required-a", t1.id, 1, "approval_required", {
        approvalId: "approval-a",
        reason: "Approve A?",
      }),
      event("required-b", t1.id, 2, "approval_required", {
        approvalId: "approval-b",
        reason: "Approve B?",
      }),
      event("resolved-a", t1.id, 3, "approval_resolved", {
        approvalId: "approval-a",
        decision: "approved",
      }),
      event("resolved-missing", t1.id, 4, "approval_resolved", {
        decision: "approved",
      }),
    ];
    const project = (events: TaskEvent[]) =>
      projectConversation({
        conversationId: "conversation",
        title: null,
        tasks: [t1],
        eventsByTask: { [t1.id]: events },
      });

    const forward = project(approvals);
    const reverse = project([...approvals].reverse());

    expect(reverse).toEqual(forward);
    expect(forward.turns[0]?.approval).toEqual(
      expect.objectContaining({
        approvalId: "approval-b",
        summary: "Approve B?",
      }),
    );
    expect(forward.needsUserAction).toBe(true);
  });

  it("attaches the latest plan_update to the turn plan", () => {
    const t1 = task("plan-task", "running", "2026-01-01T00:00:00.000Z");
    const snapshot = projectConversation({
      conversationId: t1.id,
      title: null,
      tasks: [t1],
      eventsByTask: {
        [t1.id]: [
          event("plan-draft", t1.id, 1, "plan_update", {
            content: "# Plan\n- outline",
            status: "drafting",
          }),
          event("plan-ready", t1.id, 2, "plan_update", {
            content: "# Plan\n- gather sources\n- write summary",
            status: "awaiting_approval",
          }),
        ],
      },
    });

    expect(snapshot.turns[0]?.plan).toEqual({
      content: "# Plan\n- gather sources\n- write summary",
      status: "awaiting_approval",
    });
  });

  it("approves an awaiting plan only through its plan_review resolution", () => {
    const t1 = task("plan-approval", "running", "2026-01-01T00:00:00.000Z");
    const planEvents = [
      event("plan-ready", t1.id, 1, "plan_update", {
        content: "# Plan\n- do the work",
        status: "awaiting_approval",
      }),
      event("plan-review", t1.id, 2, "approval_required", {
        approvalId: "plan-review-1",
        kind: "plan_review",
        reason: "Approve the plan?",
      }),
      event("shell-resolved", t1.id, 3, "approval_resolved", {
        approvalId: "shell-1",
        decision: "approve",
      }),
    ];
    const planResolution = event("plan-resolved", t1.id, 4, "approval_resolved", {
      approvalId: "plan-review-1",
      decision: "approve",
      kind: "plan_review",
    });
    const project = (events: TaskEvent[]) =>
      projectConversation({
        conversationId: t1.id,
        title: null,
        tasks: [t1],
        eventsByTask: { [t1.id]: events },
      });

    const pending = project(planEvents);
    expect(pending.turns[0]?.plan?.status).toBe("awaiting_approval");
    expect(pending.turns[0]?.approval?.approvalId).toBe("plan-review-1");

    const approved = project([...planEvents, planResolution]);
    expect(approved.turns[0]?.plan).toEqual({
      content: "# Plan\n- do the work",
      status: "approved",
    });
    expect(approved.turns[0]?.approval).toBeNull();
  });

  it("populates turn citations from a citations event", () => {
    const t1 = task("cited", "done", "2026-01-01T00:00:00.000Z");
    const snapshot = projectConversation({
      conversationId: t1.id,
      title: null,
      tasks: [t1],
      eventsByTask: {
        [t1.id]: [
          event("citations", t1.id, 1, "citations", {
            items: [
              {
                url: "https://example.com/study",
                title: "Example study",
                snippet: "Key finding",
                source: "web",
              },
              { url: "https://x.com/grok/status/1", source: "x" },
              { title: "No url means no citation" },
              "garbage",
              { url: "https://example.com/odd", source: "reddit" },
            ],
          }),
        ],
      },
    });

    expect(snapshot.turns[0]?.citations).toEqual([
      {
        url: "https://example.com/study",
        title: "Example study",
        snippet: "Key finding",
        source: "web",
      },
      { url: "https://x.com/grok/status/1", source: "x" },
      { url: "https://example.com/odd" },
    ]);
  });

  it("dedupes citations by URL, keeping the first occurrence", () => {
    const t1 = task("cited-dupe", "done", "2026-01-01T00:00:00.000Z");
    const snapshot = projectConversation({
      conversationId: t1.id,
      title: null,
      tasks: [t1],
      eventsByTask: {
        [t1.id]: [
          event("citations", t1.id, 1, "citations", {
            items: [
              { url: "https://example.com/a", title: "First", source: "web" },
              { url: "https://example.com/a", title: "Dup with other title" },
              { url: "https://example.com/b", source: "web" },
              { url: "https://example.com/a", snippet: "third mention" },
            ],
          }),
        ],
      },
    });

    // Same URL cited three times collapses to one card (identical render, and
    // avoids a duplicate React key on key={item.url}); first occurrence wins.
    expect(snapshot.turns[0]?.citations).toEqual([
      { url: "https://example.com/a", title: "First", source: "web" },
      { url: "https://example.com/b", source: "web" },
    ]);
  });
});

describe("mergeRunState", () => {
  it("never regresses a terminal state", () => {
    expect(mergeRunState("done", "running")).toBe("done");
    expect(mergeRunState("failed", "waiting_user")).toBe("failed");
    expect(mergeRunState("cancelled", "queued")).toBe("cancelled");
  });

  it(
    "accepts non-terminal transitions with deterministic terminal precedence",
    () => {
      expect(mergeRunState("queued", "running")).toBe("running");
      expect(mergeRunState("waiting_user", "running")).toBe("running");
      expect(mergeRunState("running", "waiting_approval")).toBe(
        "waiting_approval",
      );
      expect(mergeRunState("waiting_approval", "running")).toBe(
        "running",
      );
      expect(mergeRunState("done", "failed")).toBe("failed");
      expect(mergeRunState("failed", "done")).toBe("failed");
    },
  );
});

describe("mergeWorker", () => {
  it(
    "creates only from an explicit ID and handles terminal before start",
    () => {
      const completed = event("complete", "task", 3, "worker_completed", {
        workerId: "worker-1",
        summary: "Final worker result",
        parentWorkerId: "parent-1",
      });
      let worker = mergeWorker(undefined, completed);
      expect(worker).toEqual(
        expect.objectContaining({
          id: "worker-1",
          label: "worker-1",
          parentWorkerId: "parent-1",
          status: "done",
          result: "Final worker result",
        }),
      );
      worker = mergeWorker(
        worker,
        event("start", "task", 1, "worker_started", {
          workerId: "worker-1",
          label: "Researcher",
          objective: "Find sources",
        }),
      );
      worker = mergeWorker(
        worker,
        event("activity", "task", 4, "worker_activity", {
          workerId: "worker-1",
          summary: "Late progress",
        }),
      );
      expect(worker).toEqual(
        expect.objectContaining({
          label: "Researcher",
          objective: "Find sources",
          parentWorkerId: "parent-1",
          status: "done",
          currentActivity: null,
          result: "Final worker result",
        }),
      );
      expect(
        mergeWorker(
          undefined,
          event("missing-id", "task", 1, "worker_started", {
            label: "Fake",
          }),
        ),
      ).toBeUndefined();
    },
  );
});

describe("isProviderNoise", () => {
  it.each([
    "Grok Build session",
    "Session ready — initializing",
    "Still working on tools in the background",
    "Grok CLI v1 probing capabilities",
    "Isolated Grok profile 2",
  ])("classifies %s as diagnostic provider noise", (text) => {
    expect(isProviderNoise(text)).toBe(true);
  });

  it("does not classify useful work as noise", () => {
    expect(isProviderNoise("Reviewed the authentication flow")).toBe(false);
  });
});

describe("Phase 4 recovered timeline + approval parking", () => {
  it("folds recovered failure rows into diagnostic while keeping later work primary", () => {
    // Crash recovery keeps task.status running and emits error + recovery
    // signals without a sticky terminal status_change (mergeRunState does not
    // allow failed → running regression). Fold hides the error row from the
    // primary timeline once work continues.
    const t1 = task("task-recover", "running", "2026-01-01T00:00:00.000Z");
    t1.updatedAt = "2026-01-01T00:00:05.000Z";
    const snapshot = projectConversation({
      conversationId: "conversation",
      title: null,
      tasks: [t1],
      eventsByTask: {
        [t1.id]: [
          event("err-1", t1.id, 1, "error", {
            message: "lease expired",
          }),
          event("run-2", t1.id, 2, "status_change", {
            status: "running",
            reason: "crash recovery",
          }),
          event("step-2", t1.id, 3, "step", {
            title: "Continuing research",
            status: "start",
          }),
        ],
      },
    });
    const turn = snapshot.turns[0]!;
    expect(turn.state).toBe("running");
    // Primary error is suppressed once the run recovered (not terminal failed).
    expect(turn.error).toBeNull();
    const errRow = turn.work.find((w) => w.id === "err-1");
    const stepRow = turn.work.find((w) => w.id === "step-2");
    expect(errRow?.diagnostic).toBe(true);
    expect(stepRow?.diagnostic).toBe(false);
    // Full audit still retains the error entry in work details.
    expect(errRow?.summary).toMatch(/lease expired/i);
  });

  it("keeps approval-parked turns distinct from failed turns", () => {
    const parked = task(
      "task-parked",
      "waiting_approval",
      "2026-01-01T00:00:00.000Z",
    );
    const failed = task("task-failed", "failed", "2026-01-01T00:01:00.000Z");
    const snapshot = projectConversation({
      conversationId: "conversation",
      title: null,
      tasks: [parked, failed],
      eventsByTask: {
        [parked.id]: [
          event("ap-1", parked.id, 1, "approval_required", {
            approvalId: "approval-1",
            reason: "Allow shell",
          }),
        ],
        [failed.id]: [
          event("err-f", failed.id, 1, "error", {
            message: "Engine crashed",
          }),
          event("st-f", failed.id, 2, "status_change", {
            status: "failed",
          }),
        ],
      },
    });
    const parkedTurn = snapshot.turns.find((t) => t.id === parked.id)!;
    const failedTurn = snapshot.turns.find((t) => t.id === failed.id)!;
    expect(parkedTurn.state).toBe("waiting_approval");
    expect(parkedTurn.approval?.approvalId).toBe("approval-1");
    expect(parkedTurn.error).toBeNull();
    expect(failedTurn.state).toBe("failed");
    expect(failedTurn.error?.message).toMatch(/crashed/i);
    expect(snapshot.needsUserAction).toBe(true);
  });

  it("projects compact steps as a turn marker, not work-log JSON", () => {
    const t1 = task("compact-task", "done", "2026-01-01T00:00:00.000Z");
    const snapshot = projectConversation({
      conversationId: "conversation",
      title: null,
      tasks: [t1],
      eventsByTask: {
        [t1.id]: [
          event("c1", t1.id, 1, "step", {
            title: "compact_completed: Older turns were summarized.",
          }),
        ],
      },
    });
    expect(snapshot.turns[0]?.compaction).toEqual({
      phase: "completed",
      summary: "Older turns were summarized.",
    });
    expect(snapshot.turns[0]?.work.map((w) => w.id)).not.toContain("c1");
  });
});
