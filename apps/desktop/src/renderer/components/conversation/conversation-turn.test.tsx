import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ConversationTurn as ConversationTurnView,
  WorkEntry,
} from "@/lib/conversation-projector";
import {
  ConversationTurn,
  applyWorkerSelection,
} from "./conversation-turn";
import { WorkDetails } from "./work-details";
import { LONG_ANSWER_CHARS } from "@/lib/conversation-timeline";

function workEntry(
  id: string,
  summary: string,
  options: Partial<WorkEntry> = {},
): WorkEntry {
  return {
    id,
    timestamp: `2026-07-15T12:00:0${id.length}.000Z`,
    kind: "step",
    summary,
    detail: `${summary} detail`,
    workerId: null,
    diagnostic: false,
    payload: {},
    ...options,
  };
}

function turn(
  state: ConversationTurnView["state"] = "running",
): ConversationTurnView {
  return {
    id: "turn-1",
    taskId: "task-1",
    userMessage: "Build the release notes",
    attachments: [],
    attachmentsKnown: true,
    revisionOfTurnId: null,
    superseded: false,
    state,
    primaryRun: {
      id: "task-1",
      state,
      startedAt: "2026-07-15T12:00:00.000Z",
      completedAt: state === "done" ? "2026-07-15T12:01:00.000Z" : null,
    },
    workers: {
      alpha: {
        id: "alpha",
        label: "Research",
        objective: "Check the changelog",
        parentWorkerId: null,
        status: "running",
        currentActivity: "Reading commits",
        result: null,
      },
      beta: {
        id: "beta",
        label: "Editor",
        objective: "Shape the copy",
        parentWorkerId: null,
        status: "done",
        currentActivity: null,
        result: "Draft ready",
      },
    },
    liveSummary: state === "running" ? "Checking the changelog" : null,
    answer:
      state === "done"
        ? {
            eventId: "answer-1",
            text: "## Release notes\n\nEverything shipped.",
            createdAt: "2026-07-15T12:01:00.000Z",
          }
        : null,
    work: [
      workEntry("thought", "Private chain thought", {
        kind: "message",
        diagnostic: true,
      }),
      workEntry("tool", "Read package.json", {
        kind: "tool_request",
        workerId: "alpha",
      }),
      workEntry("session", "Grok Build session", {
        diagnostic: true,
        workerId: "beta",
      }),
    ],
    artifacts: [],
    approval: null,
    error: null,
    plan: null,
    citations: [],
  };
}

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

describe("ConversationTurn", () => {
  it("renders a running user turn with exactly one calm live work card", () => {
    const html = renderToStaticMarkup(<ConversationTurn turn={turn()} />);

    expect(html).toContain("Build the release notes");
    expect(count(html, "data-live-work-card")).toBe(1);
    expect(html).toContain("Grok is working");
  });

  it("shows truthful worker count and labels", () => {
    const html = renderToStaticMarkup(<ConversationTurn turn={turn()} />);

    expect(html).toContain("2 workers");
    expect(html).toContain("Research");
    expect(html).toContain("Editor");
    expect(html).toContain("Reading commits");
    expect(html).toContain("Draft ready");
  });

  it("uses singular worker copy", () => {
    const singleWorkerTurn = turn();
    singleWorkerTurn.workers = { alpha: singleWorkerTurn.workers.alpha! };
    const html = renderToStaticMarkup(
      <ConversationTurn turn={singleWorkerTurn} />,
    );

    expect(html).toContain("1 worker");
    expect(html).not.toContain("1 workers");
  });

  it("keeps raw thoughts and provider session noise closed by default", () => {
    const html = renderToStaticMarkup(<ConversationTurn turn={turn()} />);

    expect(html).not.toContain("Private chain thought");
    expect(html).not.toContain("Grok Build session");
  });

  it("reveals thought, tool, and diagnostic entries in controlled work details", () => {
    const runningTurn = turn();
    const html = renderToStaticMarkup(
      <WorkDetails entries={runningTurn.work} open />,
    );

    expect(html).toContain("Private chain thought");
    expect(html).toContain("Read package.json");
    expect(html).toContain("Grok Build session");
  });

  it("renders a completed markdown answer without auto-opening work", () => {
    const html = renderToStaticMarkup(<ConversationTurn turn={turn("done")} />);

    expect(html).toContain("Release notes");
    expect(html).toContain("Everything shipped.");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Private chain thought");
    expect(html).not.toContain("data-live-work-card");
    expect(html).toContain('data-turn-id="turn-1"');
    expect(html).not.toContain('data-testid="back-to-answer-start"');
  });

  it("offers back-to-start on a long answer", () => {
    const long = turn("done");
    long.answer = {
      eventId: "answer-1",
      text: "x".repeat(LONG_ANSWER_CHARS),
      createdAt: "2026-07-15T12:01:00.000Z",
    };
    const html = renderToStaticMarkup(<ConversationTurn turn={long} />);
    expect(html).toContain('data-testid="back-to-answer-start"');
    expect(html).toContain("Back to start of answer");
  });

  it("renders queued turns quietly without claiming work has started", () => {
    const html = renderToStaticMarkup(
      <ConversationTurn turn={turn("queued")} />,
    );

    expect(html).toContain("Queued");
    expect(html).not.toContain("Grok is working");
    expect(html).not.toContain("data-live-work-card");
    expect(html).not.toContain('aria-live="polite"');
  });

  it("keeps explicitly opened work visible after completion", () => {
    const html = renderToStaticMarkup(
      <ConversationTurn turn={turn("done")} workOpen />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Private chain thought");
  });

  it("filters work by selected worker without changing the turn identity", () => {
    const html = renderToStaticMarkup(
      <ConversationTurn
        turn={turn()}
        workOpen
        selectedWorkerId="alpha"
      />,
    );

    expect(html).toContain('data-task-id="task-1"');
    expect(html).toContain("Read package.json");
    expect(html).not.toContain("Grok Build session");
  });

  it("notifies controlled worker selection instead of making buttons inert", () => {
    const setInternal = vi.fn();
    const onChange = vi.fn();

    applyWorkerSelection({
      controlled: true,
      workerId: "alpha",
      setInternal,
      onChange,
    });

    expect(setInternal).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("alpha");
  });

  it("renders semantic work kinds with raw payload nested below", () => {
    const entries: WorkEntry[] = [
      workEntry("thought-kind", "Considering options", {
        kind: "message",
        diagnostic: true,
        payload: { channel: "thought", text: "Considering options" },
      }),
      workEntry("tool-kind", "Read config", {
        kind: "tool_request",
        payload: { tool: "read_file", path: "config.ts" },
      }),
      workEntry("browser-kind", "Open docs", {
        kind: "tool_request",
        payload: { tool: "browser_open", url: "https://example.com" },
      }),
      workEntry("worker-kind", "Research complete", {
        kind: "worker_completed",
        workerId: "alpha",
        payload: { workerId: "alpha", summary: "Research complete" },
      }),
      workEntry("artifact-kind", "Saved report", {
        kind: "artifact_created",
        payload: { path: "/tmp/report.md", title: "Report" },
      }),
      workEntry("diagnostic-kind", "Grok Build session", {
        diagnostic: true,
      }),
    ];

    const html = renderToStaticMarkup(<WorkDetails entries={entries} open />);
    for (const kind of [
      "thought",
      "tool",
      "browser",
      "worker",
      "artifact",
      "diagnostic",
    ]) {
      expect(html).toContain(`data-work-kind="${kind}"`);
    }
    expect(html).toContain("Show details");
    expect(html).not.toContain("{");
  });

  it("exposes one polite live region and an expanded-state disclosure", () => {
    const html = renderToStaticMarkup(<ConversationTurn turn={turn()} />);

    expect(count(html, 'aria-live="polite"')).toBe(1);
    expect(count(html, "aria-expanded=")).toBe(1);
  });

  it("keeps a superseded source collapsed and accessible with an Edited marker", () => {
    const edited = turn("done");
    edited.superseded = true;

    const html = renderToStaticMarkup(<ConversationTurn turn={edited} />);

    expect(html).toContain("data-superseded-turn");
    expect(html).toContain("Edited");
    expect(html).toContain("Build the release notes");
    expect(html).not.toContain("data-edit-turn");
  });

  it("shows Edit only when the parent supplies an eligible edit action", () => {
    const html = renderToStaticMarkup(
      <ConversationTurn turn={turn("done")} onEdit={() => {}} />,
    );

    expect(html).toContain("data-edit-turn");
    expect(html).toContain("Edit");
  });

  it("renders the only approval controls inside the affected turn with busy state", () => {
    const approvalTurn = turn("waiting_approval");
    approvalTurn.approval = {
      approvalId: "approval-1",
      eventId: "approval-event",
      summary: "Publish the report?",
      createdAt: "2026-07-15T12:00:05.000Z",
      payload: {},
    };
    const html = renderToStaticMarkup(
      <ConversationTurn
        turn={approvalTurn}
        onApprove={() => {}}
        onReject={() => {}}
        approvalBusy="approve"
      />,
    );

    expect(count(html, "data-approval-actions")).toBe(1);
    expect(count(html, "data-approve-action")).toBe(1);
    expect(count(html, "data-reject-action")).toBe(1);
    expect(html).toContain("Publish the report?");
    expect(count(html, "disabled=\"\"")).toBe(2);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('data-approval-id="approval-1"');
    expect(count(html, "data-turn-response-slot")).toBe(1);
    expect(html).not.toContain("data-live-work-card");
  });

  it("keeps a dangling approval on a terminal turn passive", () => {
    const completed = turn("done");
    completed.approval = {
      approvalId: "old-approval",
      eventId: "old-event",
      summary: "Old request",
      createdAt: "2026-07-15T12:00:05.000Z",
      payload: {},
    };
    const html = renderToStaticMarkup(
      <ConversationTurn
        turn={completed}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );

    expect(html).toContain("Old request");
    expect(html).not.toContain("data-approve-action");
    expect(html).not.toContain("data-reject-action");
  });

  it("renders plan review as the single approval surface", () => {
    const planTurn = turn("waiting_approval");
    planTurn.approval = {
      approvalId: "plan-approval",
      eventId: "plan-approval-event",
      summary: "Review the plan",
      createdAt: "2026-07-15T12:00:05.000Z",
      payload: { kind: "plan_review" },
    };
    planTurn.plan = {
      content: "# Plan\n\nRead the [source](https://example.com/source).",
      status: "awaiting_approval",
    };

    const html = renderToStaticMarkup(
      <ConversationTurn
        turn={planTurn}
        onApprove={() => {}}
        onReject={() => {}}
        onOpenUrl={() => {}}
      />,
    );

    expect(count(html, "data-approval-actions")).toBe(1);
    expect(count(html, "data-approve-action")).toBe(1);
    expect(html).toContain('data-plan-status="awaiting_approval"');
    expect(html).not.toContain("Review the plan");
  });

  it("does not let an unrelated approval take over an awaiting plan", () => {
    const planTurn = turn("waiting_approval");
    planTurn.approval = {
      approvalId: "shell-approval",
      eventId: "shell-approval-event",
      summary: "Run the release verification?",
      createdAt: "2026-07-15T12:00:05.000Z",
      payload: { kind: "tool", tool: "shell" },
    };
    planTurn.plan = {
      content: "# Plan\n\nPrepare the release.",
      status: "awaiting_approval",
    };

    const html = renderToStaticMarkup(
      <ConversationTurn
        turn={planTurn}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );

    expect(count(html, "data-approval-actions")).toBe(1);
    expect(count(html, "data-approve-action")).toBe(1);
    expect(html).toContain("Run the release verification?");
    expect(html).toContain('data-plan-status="awaiting_approval"');
    expect(html).toContain('data-plan-actionable="false"');
  });

  it("keeps a failed turn recovery beside its preserved answer", () => {
    const failed = turn("failed");
    failed.answer = {
      eventId: "answer-before-failure",
      text: "The completed section remains available.",
      createdAt: "2026-07-15T12:00:04.000Z",
    };
    failed.error = {
      eventId: "primary-error",
      message: "Authentication expired",
      createdAt: "2026-07-15T12:00:05.000Z",
    };
    const html = renderToStaticMarkup(
      <ConversationTurn turn={failed} onRecoveryAction={() => {}} />,
    );

    expect(html).toContain("The completed section remains available.");
    expect(count(html, "data-turn-recovery")).toBe(1);
    expect(html).toContain('data-recovery-task-id="task-1"');
  });

  it("renders terminal question choices inside their owning turn", () => {
    const html = renderToStaticMarkup(
      <ConversationTurn
        turn={turn("done")}
        question={{
          prompt: "Which format?",
          options: [{ id: "pdf", label: "PDF" }],
        }}
        onAnswerQuestion={() => {}}
        answerBusy
      />,
    );

    expect(html).toContain("Which format?");
    expect(html).toContain("PDF");
    expect(count(html, "data-turn-question")).toBe(1);
    expect(html).toContain("disabled");
  });

  it("exposes copy and retry on a completed assistant turn with focus-within actions", () => {
    const html = renderToStaticMarkup(
      <ConversationTurn turn={turn("done")} onRetryTurn={() => {}} />,
    );

    expect(html).toContain("data-assistant-actions");
    expect(html).toContain("data-copy-answer");
    expect(html).toContain("data-retry-turn");
    expect(html).toContain('aria-label="Copy"');
    expect(html).toContain('aria-label="Retry"');
    expect(html).toContain("group-focus-within/assistant:opacity-100");
  });

  it("hides retry while the turn is still live", () => {
    const html = renderToStaticMarkup(
      <ConversationTurn turn={turn("running")} onRetryTurn={() => {}} />,
    );

    expect(html).not.toContain("data-retry-turn");
    expect(html).not.toContain("data-copy-answer");
  });

  it("offers retry on a failed terminal turn without requiring an answer", () => {
    const failed = turn("failed");
    failed.answer = null;
    failed.error = {
      eventId: "err-1",
      message: "boom",
      createdAt: "2026-07-15T12:00:05.000Z",
    };
    const html = renderToStaticMarkup(
      <ConversationTurn turn={failed} onRetryTurn={() => {}} />,
    );

    expect(html).toContain("data-retry-turn");
    expect(html).not.toContain("data-copy-answer");
  });

  it("shows Edit when onSaveEdit is provided for inline revision", () => {
    const html = renderToStaticMarkup(
      <ConversationTurn
        turn={turn("done")}
        onSaveEdit={() => {}}
      />,
    );

    expect(html).toContain("data-edit-turn");
    expect(html).toContain("Edit");
    expect(html).not.toContain("data-edit-message");
  });

  it("freezes the user bubble while regenerating after an edit", () => {
    const html = renderToStaticMarkup(
      <ConversationTurn
        turn={turn("done")}
        onSaveEdit={() => {}}
        regenerating
      />,
    );

    expect(html).toContain('data-regenerating="true"');
    expect(html).toContain("data-regenerating-label");
    expect(html).not.toContain("data-edit-turn");
  });
});
