import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import {
  buildDrainedCreateInput,
  loadFollowUpSettings,
  mergeFollowUpSettings,
  resolvePriorProviderSessionId,
} from "./follow-up-settings.js";

describe("follow-up-settings", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-fus-"));
    db = openDatabase(path.join(dir, "test.sqlite"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads model/strict/skills from the parent task", () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tasks (
        id, goal, mode, status, model, effort, policy_json,
        skills_json, mcp_json, created_at, updated_at, conversation_id
      ) VALUES (?, ?, 'interactive', 'running', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "parent-1",
      "root",
      "grok-4",
      "heavy",
      JSON.stringify({
        approvalMode: "strict",
        workspaceRoots: ["/ws"],
        allowShell: false,
        allowNetworkTools: true,
      }),
      JSON.stringify(["desk-image"]),
      JSON.stringify(["desk-browser"]),
      now,
      now,
      "conv-1",
    );

    const settings = loadFollowUpSettings(db, {
      parentTaskId: "parent-1",
      conversationId: "conv-1",
    });
    expect(settings).toMatchObject({
      model: "grok-4",
      effort: "heavy",
      approvalMode: "strict",
      workspaceRoots: ["/ws"],
      skills: ["desk-image"],
      mcpServerIds: ["desk-browser"],
      allowShell: false,
      allowNetworkTools: true,
    });
  });

  it("buildDrainedCreateInput never falls back to grok-4.5/balanced empties", () => {
    const input = buildDrainedCreateInput(
      {
        id: "item-1",
        text: "follow up",
        attachments: [],
        parentTaskId: "parent-1",
        revisionOfTaskId: null,
      },
      {
        model: "grok-4",
        effort: "heavy",
        approvalMode: "strict",
        workspaceRoots: ["/ws"],
        skills: ["desk-image"],
        mcpServerIds: ["fs"],
        planFirst: true,
        rolePack: "writer",
        allowShell: false,
        allowNetworkTools: true,
        providerSessionId: "sess-9",
      },
    );
    expect(input.model).toBe("grok-4");
    expect(input.effort).toBe("heavy");
    expect(input.approvalMode).toBe("strict");
    expect(input.skills).toEqual(["desk-image"]);
    expect(input.mcpServerIds).toEqual(["fs"]);
    expect(input.workspaceRoots).toEqual(["/ws"]);
    expect(input.planFirst).toBe(true);
    expect(input.rolePack).toBe("writer");
    expect(input).not.toMatchObject({
      model: "grok-4.5",
      approvalMode: "balanced",
    });
  });

  it("resolvePriorProviderSessionId prefers parent attempts then task row", () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tasks (
        id, goal, mode, status, model, effort, policy_json,
        created_at, updated_at, conversation_id, provider_session_id
      ) VALUES (?, 'g', 'interactive', 'done', 'grok-4.5', 'normal', '{}', ?, ?, ?, ?)`,
    ).run("parent-1", now, now, "conv-1", "sess-from-task");
    db.prepare(
      `INSERT INTO tasks (
        id, goal, mode, status, model, effort, policy_json,
        created_at, updated_at, conversation_id, parent_task_id
      ) VALUES (?, 'g', 'interactive', 'queued', 'grok-4.5', 'normal', '{}', ?, ?, ?, ?)`,
    ).run("child-1", now, now, "conv-1", "parent-1");

    expect(
      resolvePriorProviderSessionId(db, {
        taskId: "child-1",
        parentTaskId: "parent-1",
        conversationId: "conv-1",
      }),
    ).toBe("sess-from-task");
  });

  it("composer override wins for the next turn's model/effort/approval", () => {
    const merged = mergeFollowUpSettings(
      {
        model: "grok-4.5",
        effort: "normal",
        approvalMode: "balanced",
        workspaceRoots: ["/ws"],
        skills: ["desk-image"],
        mcpServerIds: [],
        planFirst: false,
        rolePack: null,
        allowShell: true,
        allowNetworkTools: true,
        providerSessionId: null,
      },
      { model: "grok-4", effort: "heavy", approvalMode: "strict", planFirst: true },
    );
    expect(merged).toMatchObject({
      model: "grok-4",
      effort: "heavy",
      approvalMode: "strict",
      planFirst: true,
      skills: ["desk-image"],
      workspaceRoots: ["/ws"],
    });
  });
});
