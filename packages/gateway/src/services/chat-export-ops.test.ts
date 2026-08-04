import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { exportChatMarkdown } from "./chat-export-ops.js";
import type { Task } from "@grokdesk/shared";

function task(
  id: string,
  over: Partial<Task> = {},
): Task {
  return {
    id,
    goal: `goal ${id}`,
    title: `title ${id}`,
    mode: "interactive",
    status: "done",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    ...over,
  };
}

describe("exportChatMarkdown", () => {
  it("throws when task missing", () => {
    expect(() =>
      exportChatMarkdown("missing", {
        getTask: () => null,
        listTasks: () => [],
        listEvents: () => [],
        dataDir: "/data",
      }),
    ).toThrow(/not found/i);
  });

  it("writes markdown under workspace exports when root exists", () => {
    const root = task("root");
    const child = task("child", {
      parentTaskId: "root",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    const written: Array<{ path: string; body: string }> = [];
    const r = exportChatMarkdown("child", {
      getTask: (id) =>
        id === "root" ? root : id === "child" ? child : null,
      listTasks: () => [root, child],
      listEvents: (id) =>
        id === "root"
          ? [
              {
                kind: "message",
                payload: { role: "user", text: "hello", channel: "text" },
                createdAt: "t",
                seq: 1,
              },
            ]
          : [],
      dataDir: "/data",
      existsSync: (p) => p === "/ws",
      mkdirSync: vi.fn(),
      writeFileSync: (p, body) => {
        written.push({ path: p, body: String(body) });
      },
      join: path.join,
    });
    expect(r.path).toContain(path.join("/ws", "exports"));
    expect(r.markdown).toContain("hello");
    expect(written).toHaveLength(1);
    expect(written[0]!.body).toContain("hello");
  });

  it("paginates events by seq and stops when seq does not advance", () => {
    const root = task("root");
    const calls: number[] = [];
    const page1 = Array.from({ length: 500 }, (_, i) => ({
      kind: "message",
      payload: { role: "user", text: `m${i}`, channel: "text" },
      createdAt: "t",
      seq: i + 1,
    }));
    const page2 = [
      {
        kind: "message",
        payload: { role: "assistant", text: "done", channel: "text" },
        createdAt: "t2",
        seq: 501,
      },
    ];
    const r = exportChatMarkdown("root", {
      getTask: () => root,
      listTasks: () => [root],
      listEvents: (_id, after) => {
        calls.push(after);
        if (after === 0) return page1;
        if (after === 500) return page2;
        return [];
      },
      dataDir: "/data",
      existsSync: () => false,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      join: path.join,
    });
    expect(calls).toEqual([0, 500]);
    expect(r.markdown).toContain("m0");
    expect(r.markdown).toContain("done");

    // Missing seq must not re-fetch the same page forever.
    const stuckCalls: number[] = [];
    exportChatMarkdown("root", {
      getTask: () => root,
      listTasks: () => [root],
      listEvents: (_id, after) => {
        stuckCalls.push(after);
        return page1.map(({ seq: _s, ...rest }) => rest);
      },
      dataDir: "/data",
      existsSync: () => false,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      join: path.join,
    });
    expect(stuckCalls).toEqual([0]);
  });
});
