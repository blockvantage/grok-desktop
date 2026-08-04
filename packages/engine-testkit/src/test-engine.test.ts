import path from "node:path";
import { describe, it, expect } from "vitest";
import type { Task } from "@grokdesk/shared";
import type { NormalizedEngineEvent } from "@grokdesk/engine-grok";
import { TestEngine } from "./test-engine.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: "task-1",
    goal: "Ship the test engine",
    mode: "interactive",
    status: "running",
    model: "grok",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: ["/tmp/workspace"],
      allowNetworkTools: true,
      allowShell: true,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  };
}

describe("TestEngine", () => {
  it("emits plan, message, write tool, artifact, and done", async () => {
    const engine = new TestEngine();
    const task = makeTask();
    const events: NormalizedEngineEvent[] = [];

    await engine.run({
      task,
      systemPreamble: "",
      onEvent: async (event) => {
        events.push(event);
        return "continue";
      },
    });

    expect(events.map((e) => e.type)).toEqual([
      "step",
      "step",
      "message",
      "tool_request",
      "tool_result",
      "artifact",
      "done",
    ]);

    expect(events[0]).toMatchObject({
      type: "step",
      title: "Plan work",
      status: "start",
    });
    expect(events[2]).toMatchObject({
      type: "message",
      role: "assistant",
      text: "Working on: Ship the test engine",
    });

    const outPath = path.join("/tmp/workspace", "grokdesk-output.md");
    expect(events[3]).toMatchObject({
      type: "tool_request",
      id: "tool-1",
      tool: "write_file",
      path: outPath,
    });
    expect(events[6]).toMatchObject({
      type: "done",
      summary: "Completed fake run",
    });
  });

  it("stops when onEvent returns abort", async () => {
    const engine = new TestEngine();
    const events: NormalizedEngineEvent[] = [];

    await engine.run({
      task: makeTask(),
      systemPreamble: "",
      onEvent: async (event) => {
        events.push(event);
        if (event.type === "message") return "abort";
        return "continue";
      },
    });

    expect(events.map((e) => e.type)).toEqual(["step", "step", "message"]);
    expect(events.some((e) => e.type === "tool_request")).toBe(false);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("cancel prevents further events for that task", async () => {
    const engine = new TestEngine();
    const events: NormalizedEngineEvent[] = [];

    await engine.run({
      task: makeTask({ id: "cancel-me" }),
      systemPreamble: "",
      onEvent: async (event) => {
        events.push(event);
        if (event.type === "step" && event.status === "start") {
          await engine.cancel("cancel-me");
        }
        return "continue";
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "step",
      status: "start",
    });
  });

  it("cancel before run emits nothing", async () => {
    const engine = new TestEngine();
    const events: NormalizedEngineEvent[] = [];

    await engine.cancel("task-1");
    await engine.run({
      task: makeTask({ id: "task-1" }),
      systemPreamble: "",
      onEvent: async (event) => {
        events.push(event);
        return "continue";
      },
    });

    expect(events).toEqual([]);
  });

  it("does not execute own tools (gateway mediates)", () => {
    expect(new TestEngine().executesOwnTools).toBe(false);
  });
});
