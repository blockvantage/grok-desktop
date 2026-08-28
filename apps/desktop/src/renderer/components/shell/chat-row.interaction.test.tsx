/**
 * jsdom: two-line roster row with last-turn summary (Phase 3.4).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Task } from "@grokdesk/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatRow } from "./app-sidebar";
import type { Chat } from "@/lib/chats";

function task(partial: Partial<Task> & Pick<Task, "id" | "goal">): Task {
  return {
    title: "Launch brief",
    mode: "interactive",
    status: "done",
    model: "grok-4.5",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: [],
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
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    completedAt: "2026-08-26T00:00:00.000Z",
    ...partial,
  };
}

function chat(partial?: Partial<Chat>): Chat {
  const root = task({
    id: "root",
    goal: "Drafted three channels for the Q3 launch. More later.",
    title: "Launch brief",
  });
  return {
    id: root.id,
    root,
    turns: [root],
    latest: root,
    title: "Launch brief",
    updatedAt: root.updatedAt,
    ...partial,
  };
}

describe("ChatRow roster", () => {
  it("shows a two-line last-turn summary and activity", () => {
    render(
      <TooltipProvider>
        <ChatRow
          chat={chat()}
          active={false}
          renaming={false}
          onOpen={vi.fn()}
          onStartRename={vi.fn()}
          onCancelRename={vi.fn()}
          onCommitRename={vi.fn()}
          onRequestDelete={vi.fn()}
        />
      </TooltipProvider>,
    );
    const row = screen.getByTestId("chat-row");
    expect(row.getAttribute("data-roster-activity")).toBe("completed");
    expect(screen.getByTestId("chat-row-summary").textContent).toContain(
      "Drafted three channels",
    );
  });
});
