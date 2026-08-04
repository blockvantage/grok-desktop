import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  collectChatThreadMembers,
  eventsToMarkdown,
  resolveChatExportDir,
  resolveChatRootTask,
  safeChatExportStem,
} from "./chat-export.js";

type T = {
  id: string;
  parentTaskId: string | null;
  createdAt: string;
  title?: string | null;
  goal: string;
};

function task(
  id: string,
  parent: string | null,
  createdAt: string,
  goal = id,
): T {
  return { id, parentTaskId: parent, createdAt, goal, title: goal };
}

describe("chat thread membership", () => {
  it("resolveChatRootTask walks parent chain", () => {
    const a = task("a", null, "1");
    const b = task("b", "a", "2");
    const c = task("c", "b", "3");
    const map = new Map(
      [a, b, c].map((t) => [t.id, t] as const),
    );
    expect(resolveChatRootTask(c, (id) => map.get(id) ?? null).id).toBe("a");
  });

  it("collectChatThreadMembers returns full descendant closure sorted", () => {
    const a = task("a", null, "2020-01-01T00:00:00.000Z");
    const b = task("b", "a", "2020-01-02T00:00:00.000Z");
    const c = task("c", "a", "2020-01-03T00:00:00.000Z");
    const d = task("d", "b", "2020-01-04T00:00:00.000Z");
    const other = task("x", null, "2020-01-05T00:00:00.000Z");
    const members = collectChatThreadMembers(a, [a, b, c, d, other]);
    expect(members.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("export path helpers", () => {
  it("safeChatExportStem sanitizes and truncates", () => {
    expect(safeChatExportStem("Hello World!!")).toBe("Hello_World_");
    expect(safeChatExportStem("a".repeat(100)).length).toBe(40);
  });

  it("resolveChatExportDir prefers existing workspace root", () => {
    const dir = resolveChatExportDir({
      workspaceRoots: ["/ws"],
      dataDir: "/data",
      existsSync: (p) => p === "/ws",
      join: path.join,
    });
    expect(dir).toBe(path.join("/ws", "exports"));
  });

  it("resolveChatExportDir falls back to dataDir", () => {
    const dir = resolveChatExportDir({
      workspaceRoots: ["/missing"],
      dataDir: "/data",
      existsSync: () => false,
      join: path.join,
    });
    expect(dir).toBe(path.join("/data", "exports"));
  });
});

describe("eventsToMarkdown", () => {
  it("includes title, goal, user and assistant text", () => {
    const md = eventsToMarkdown({
      title: "Weekly brief",
      goal: "Draft a marketing brief",
      events: [
        {
          type: "message",
          createdAt: "2026-07-11T00:00:00.000Z",
          payload: { role: "user", channel: "text", text: "Draft a marketing brief" },
        },
        {
          type: "message",
          createdAt: "2026-07-11T00:00:01.000Z",
          payload: {
            role: "assistant",
            channel: "thought",
            text: "thinking quietly",
          },
        },
        {
          type: "message",
          createdAt: "2026-07-11T00:00:02.000Z",
          payload: {
            role: "assistant",
            channel: "text",
            text: "Here is your brief outline.",
          },
        },
      ],
    });
    expect(md).toContain("# Weekly brief");
    expect(md).toContain("**Goal:** Draft a marketing brief");
    expect(md).toContain("### User");
    expect(md).toContain("Draft a marketing brief");
    expect(md).toContain("### Assistant");
    expect(md).toContain("Here is your brief outline.");
    expect(md).not.toContain("thinking quietly");
  });
});
