import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildSessionSearchView,
  deskHitsFromTasks,
  rosterHitsFromTasks,
  scanForeignSessionsFromHome,
} from "./session-roster.js";
import type { Task } from "@grokdesk/shared";

function task(partial: Partial<Task> & Pick<Task, "id" | "goal">): Task {
  return {
    title: null,
    mode: "interactive",
    status: "done",
    model: "grok-4.5",
    effort: "normal",
    planFirst: false,
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: ["/ws"],
      allowNetworkTools: true,
      allowShell: false,
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

describe("deskHitsFromTasks", () => {
  it("finds chats by title/goal and skips follow-up rows as roots", () => {
    const hits = deskHitsFromTasks(
      [
        task({ id: "root", title: "Launch brief", goal: "Write Q3" }),
        task({
          id: "child",
          goal: "brief follow-up",
          parentTaskId: "root",
        }),
        task({ id: "other", title: "Kitchen", goal: "Cook pasta" }),
      ],
      "brief",
    );
    expect(hits.map((h) => h.sessionId)).toEqual(["root"]);
  });

  it("uses the latest follow-up as lastTurnSummary on roster rows", () => {
    const hits = rosterHitsFromTasks([
      task({
        id: "root",
        title: "Launch brief",
        goal: "Write Q3",
        status: "done",
        updatedAt: "2026-08-26T00:00:00.000Z",
      }),
      task({
        id: "child",
        goal: "Add a pricing table",
        parentTaskId: "root",
        status: "running",
        updatedAt: "2026-08-27T00:00:00.000Z",
        createdAt: "2026-08-27T00:00:00.000Z",
      }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sessionId).toBe("root");
    expect(hits[0]!.lastTurnSummary).toBe("Add a pricing table");
    expect(hits[0]!.activity).toBe("working");
  });
});

describe("buildSessionSearchView", () => {
  it("prefers bootstrapping from ACP and de-dupes ids", () => {
    const view = buildSessionSearchView({
      deskHits: [
        {
          sessionId: "s1",
          title: "Desk",
          lastTurnSummary: "A",
          updatedAt: null,
          activity: "completed",
          headless: false,
        },
      ],
      acp: {
        status: "bootstrapping",
        headless: "exclude",
        hits: [
          {
            sessionId: "s1",
            title: "Engine",
            lastTurnSummary: "B",
            updatedAt: null,
            activity: "idle",
            headless: false,
          },
          {
            sessionId: "s2",
            title: "Other",
            lastTurnSummary: "C",
            updatedAt: null,
            activity: "working",
            headless: false,
          },
        ],
      },
    });
    expect(view.status).toBe("bootstrapping");
    expect(view.hits.map((h) => h.sessionId)).toEqual(["s1", "s2"]);
    expect(view.hits[0]!.title).toBe("Desk");
  });
});

describe("scanForeignSessionsFromHome", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-foreign-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads Claude jsonl metadata from a fake home", () => {
    const project = path.join(dir, ".claude", "projects", "-repo");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, "sess-1.jsonl"),
      `${JSON.stringify({ cwd: "/repo", customTitle: "Fix login", type: "user" })}\n`,
    );
    const list = scanForeignSessionsFromHome({
      homeDir: dir,
      cwd: "/repo",
      nowMs: Date.parse("2026-08-27T00:00:00.000Z"),
    });
    expect(list).toHaveLength(1);
    expect(list[0]!.tool).toBe("claude");
    expect(list[0]!.title).toBe("Fix login");
    expect(list[0]!.nativeId).toBe("sess-1");
  });
});
