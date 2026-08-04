import { describe, it, expect, vi } from "vitest";
import { runWithMemory } from "./run-with-memory.js";
import type { Task } from "@grokdesk/shared";
import type { RunContext } from "./run-context.js";

function baseTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    goal: "remember this",
    title: null,
    mode: "interactive",
    status: "queued",
    model: "m",
    effort: "fast",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: ["/ws"],
      allowShell: false,
      allowNetworkTools: false,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    ...over,
  };
}

describe("runWithMemory", () => {
  it("no-ops when task is missing", () => {
    const setRunContext = vi.fn();
    const pumpQueue = vi.fn();
    runWithMemory("missing", {
      getTask: () => null,
      retrieveMemory: () => [],
      formatMemoryPreamble: () => "",
      loadAttachmentsPreamble: () => null,
      setRunContext,
      pumpQueue,
    });
    expect(setRunContext).not.toHaveBeenCalled();
    expect(pumpQueue).not.toHaveBeenCalled();
  });

  it("assembles memory + attachments + transcript and pumps queue", () => {
    let ctx: RunContext | null = null;
    runWithMemory(
      "t1",
      {
        getTask: () => baseTask({ parentTaskId: "parent-1" }),
        retrieveMemory: (goal) => {
          expect(goal).toBe("remember this");
          return [{ id: "m1" }, { id: "m2" }];
        },
        formatMemoryPreamble: () => "Memory block",
        loadAttachmentsPreamble: (root) => {
          expect(root).toBe("/ws");
          return "Attachments here";
        },
        getConversationId: () => "conv-1",
        buildTranscriptFallback: (cid, opts) => {
          expect(cid).toBe("conv-1");
          expect(opts.maxChars).toBe(12_000);
          expect(opts.throughTaskId).toBe("parent-1");
          return "earlier turns";
        },
        setRunContext: (c) => {
          ctx = c;
        },
        pumpQueue: vi.fn(),
      },
      { requestId: "req-9", runAttemptId: "att-1" },
    );

    expect(ctx).not.toBeNull();
    expect(ctx!.taskId).toBe("t1");
    expect(ctx!.requestId).toBe("req-9");
    expect(ctx!.runAttemptId).toBe("att-1");
    expect(ctx!.systemPreamble).toContain("Memory block");
    expect(ctx!.systemPreamble).toContain("Attachments here");
    expect(ctx!.systemPreamble).toContain("earlier turns");
    expect(ctx!.provenance).toEqual(
      expect.arrayContaining([
        "memory:2",
        "attachments",
        "transcript_fallback",
      ]),
    );
  });

  it("skips attachments when no workspace root", () => {
    let ctx: RunContext | null = null;
    const loadAtt = vi.fn();
    runWithMemory("t1", {
      getTask: () =>
        baseTask({
          policySnapshot: {
            approvalMode: "balanced",
            workspaceRoots: [],
            allowShell: false,
            allowNetworkTools: false,
          },
        }),
      retrieveMemory: () => [],
      formatMemoryPreamble: () => "",
      loadAttachmentsPreamble: loadAtt,
      setRunContext: (c) => {
        ctx = c;
      },
      pumpQueue: () => {},
    });
    expect(loadAtt).not.toHaveBeenCalled();
    expect(ctx!.systemPreamble).toBe("");
  });

  it("builds revision history only through the source turn parent", () => {
    const source = baseTask({ id: "source", parentTaskId: "source-parent" });
    const revision = baseTask({
      id: "revision",
      goal: "revised request",
      parentTaskId: source.id,
      revisionOfTaskId: source.id,
    });
    const buildTranscriptFallback = vi.fn(() => "prior context");

    runWithMemory(revision.id, {
      getTask: (id) =>
        id === revision.id ? revision : id === source.id ? source : null,
      retrieveMemory: () => [],
      formatMemoryPreamble: () => "",
      loadAttachmentsPreamble: () => null,
      getConversationId: () => "conversation-1",
      buildTranscriptFallback,
      setRunContext: () => {},
      pumpQueue: () => {},
    });

    expect(buildTranscriptFallback).toHaveBeenCalledWith("conversation-1", {
      maxChars: 12_000,
      throughTaskId: "source-parent",
    });
  });

  it("uses exact per-task attachments and excludes removed revision inputs", () => {
    let ctx: RunContext | null = null;
    const legacyLoader = vi.fn(() => "legacy manifest should not be used");
    const revision = baseTask({
      id: "revision",
      parentTaskId: "source",
      revisionOfTaskId: "source",
      attachments: [
        {
          id: "kept",
          name: "kept.png",
          kind: "image",
          sourcePath: "/old/kept.png",
          stagedPath: "/ws/attachments/kept.png",
        },
      ],
    });
    const source = baseTask({ id: "source", parentTaskId: null });

    runWithMemory(revision.id, {
      getTask: (id) => (id === revision.id ? revision : source),
      retrieveMemory: () => [],
      formatMemoryPreamble: () => "",
      loadAttachmentsPreamble: legacyLoader,
      setRunContext: (value) => {
        ctx = value;
      },
      pumpQueue: () => {},
    });

    expect(legacyLoader).not.toHaveBeenCalled();
    expect(ctx!.systemPreamble).toContain("kept.png");
    expect(ctx!.systemPreamble).not.toContain("removed.png");
  });

  it("treats an accepted empty attachment list as exact, not legacy", () => {
    const legacyLoader = vi.fn(() => "stale cumulative attachment");
    let ctx: RunContext | null = null;
    runWithMemory("exact-empty", {
      getTask: () => baseTask({ id: "exact-empty", attachments: [] }),
      retrieveMemory: () => [],
      formatMemoryPreamble: () => "",
      loadAttachmentsPreamble: legacyLoader,
      setRunContext: (value) => {
        ctx = value;
      },
      pumpQueue: () => {},
    });

    expect(legacyLoader).not.toHaveBeenCalled();
    expect(ctx!.systemPreamble).not.toContain("stale cumulative attachment");
  });

  it("uses the cumulative manifest only for legacy tasks with unknown metadata", () => {
    let ctx: RunContext | null = null;
    runWithMemory("legacy", {
      getTask: () => baseTask({ id: "legacy", attachments: null }),
      retrieveMemory: () => [],
      formatMemoryPreamble: () => "",
      loadAttachmentsPreamble: () => "legacy attachment prompt",
      setRunContext: (value) => {
        ctx = value;
      },
      pumpQueue: () => {},
    });
    expect(ctx!.systemPreamble).toContain("legacy attachment prompt");
  });
});
