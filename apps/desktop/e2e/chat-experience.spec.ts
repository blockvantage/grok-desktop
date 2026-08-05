import { test, expect } from "@playwright/test";
import type { Task, TaskEvent } from "@grokdesk/shared";
import { classifyBalancedShellCommand } from "../../../packages/shared/src/safe-shell-command";
import { parseStreamingJsonLine } from "../../../packages/engine-grok/src/events";
import { projectConversation } from "../src/renderer/lib/conversation-projector";
import { REFINED_CHAT_TRACE } from "./fixtures/scenarios";

const taskId = "trace-task";
const startedAt = "2026-08-05T12:00:00.000Z";

function task(status: Task["status"]): Task {
  return {
    id: taskId,
    goal: "Review the app and cite the source",
    title: "Refined chat trace",
    mode: "interactive",
    status,
    model: "grok",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: ["/workspace"],
      allowNetworkTools: true,
      allowShell: true,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    attachments: [],
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: startedAt,
    updatedAt: "2026-08-05T12:00:10.000Z",
    completedAt:
      status === "done" ? "2026-08-05T12:00:10.000Z" : null,
  };
}

function event(
  seq: number,
  kind: TaskEvent["kind"],
  payload: Record<string, unknown>,
): TaskEvent {
  return {
    id: `trace-${seq}`,
    taskId,
    seq,
    kind,
    payload,
    createdAt: `2026-08-05T12:00:0${seq}.000Z`,
  };
}

test.describe("refined chat production trace", () => {
  test("quarantines protocol payloads and classifies terminal risk precisely", () => {
    expect(parseStreamingJsonLine(REFINED_CHAT_TRACE.nestedImageUpdate)).toEqual(
      [],
    );

    const [inspection] = parseStreamingJsonLine(
      REFINED_CHAT_TRACE.safeInspection,
    );
    expect(inspection).toMatchObject({
      type: "tool_request",
      tool: "shell",
      command: "git status --short",
    });
    expect(
      classifyBalancedShellCommand("git status --short", ["/workspace"]),
    ).toEqual({ safe: true, reason: "read_only" });
    expect(
      classifyBalancedShellCommand(REFINED_CHAT_TRACE.destructiveCommand, [
        "/workspace",
      ]).safe,
    ).toBe(false);
  });

  test("keeps one approval surface while narration stays out of the answer", () => {
    const snapshot = projectConversation({
      conversationId: taskId,
      title: null,
      tasks: [task("waiting_approval")],
      eventsByTask: {
        [taskId]: [
          event(1, "message", {
            role: "assistant",
            channel: "text",
            text: REFINED_CHAT_TRACE.narration,
          }),
          event(2, "approval_required", {
            approvalId: "destructive-approval",
            reason: "Remove generated preview files?",
            command: REFINED_CHAT_TRACE.destructiveCommand,
          }),
        ],
      },
    });

    expect(snapshot.needsUserAction).toBe(true);
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]?.approval?.approvalId).toBe(
      "destructive-approval",
    );
    expect(snapshot.turns[0]?.liveSummary).toBe(
      REFINED_CHAT_TRACE.narration,
    );
    expect(snapshot.turns[0]?.answer).toBeNull();
  });

  test("settles into a clean linked answer after approval", () => {
    const snapshot = projectConversation({
      conversationId: taskId,
      title: null,
      tasks: [task("done")],
      eventsByTask: {
        [taskId]: [
          event(1, "message", {
            role: "assistant",
            channel: "text",
            text: JSON.stringify({
              type: "tool_call_update",
              content: [{ type: "image", data: "A".repeat(4_096) }],
            }),
          }),
          event(2, "approval_required", {
            approvalId: "destructive-approval",
            reason: "Remove generated preview files?",
          }),
          event(3, "approval_resolved", {
            approvalId: "destructive-approval",
            decision: "reject",
          }),
          event(4, "message", {
            role: "assistant",
            channel: "text",
            terminal: true,
            text: REFINED_CHAT_TRACE.finalAnswer,
          }),
          event(5, "citations", { items: [REFINED_CHAT_TRACE.citation] }),
        ],
      },
    });

    const turn = snapshot.turns[0];
    expect(turn?.answer?.text).toBe(REFINED_CHAT_TRACE.finalAnswer);
    expect(turn?.answer?.text).not.toContain("tool_call_update");
    expect(turn?.approval).toBeNull();
    expect(turn?.citations).toEqual([REFINED_CHAT_TRACE.citation]);
    expect(turn?.answer?.text).toContain("](https://");
  });
});
