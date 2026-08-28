import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SCHEMA_VERSION, openDatabase, type Db } from "../db.js";
import { ConversationService } from "../services/conversations.js";
import { TaskService } from "../services/tasks.js";

describe("conversations / turns (TASK-02)", () => {
  let dir: string;
  let db: Db;
  let conv: ConversationService;
  let tasks: TaskService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-conv-"));
    db = openDatabase(path.join(dir, "db.sqlite"));
    conv = new ConversationService(db);
    tasks = new TaskService(db);
  });

  afterEach(() => {
    // Windows refuses to unlink open better-sqlite3 handles (EBUSY).
    try {
      db.close();
    } catch {
      /* already closed in reopen tests */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("migrates to the current schema with conversations and turns", () => {
    const db = openDatabase(path.join(dir, "v.sqlite"));
    const ver = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(Number(ver.value)).toBe(CURRENT_SCHEMA_VERSION);
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('conversations','turns')",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toContain("conversations");
    expect(tables).toContain("turns");
    db.close();
  });

  it("follow-up task reuses parent conversation", () => {
    const root = tasks.create({
      goal: "root goal",
      workspaceRoots: [dir],
    });
    const c1 = conv.ensureForTask({
      taskId: root.id,
      modelId: "grok-4.5",
    });
    conv.appendTurn({
      conversationId: c1.id,
      taskId: root.id,
      role: "user",
      content: "root goal",
      contextStrategy: "transcript_fallback",
      providerId: "grok",
      modelId: "grok-4.5",
    });

    const child = tasks.create({
      goal: "follow up",
      workspaceRoots: [dir],
      parentTaskId: root.id,
    });
    const c2 = conv.ensureForTask({
      taskId: child.id,
      parentTaskId: root.id,
    });
    expect(c2.id).toBe(c1.id);
    conv.appendTurn({
      conversationId: c2.id,
      taskId: child.id,
      role: "user",
      content: "follow up",
      contextStrategy: "transcript_fallback",
    });
    const turns = conv.listTurns(c1.id);
    expect(turns).toHaveLength(2);
  });

  it("idempotently reconciles one conversation and user turn per task", () => {
    const root = tasks.create({
      goal: "accepted before a crash",
      workspaceRoots: [dir],
    });
    const first = conv.ensureForTask({
      taskId: root.id,
      modelId: root.model,
      providerId: "grok",
    });
    const second = conv.ensureForTask({
      taskId: root.id,
      modelId: root.model,
      providerId: "grok",
    });
    expect(second.id).toBe(first.id);

    const input = {
      conversationId: first.id,
      taskId: root.id,
      role: "user" as const,
      content: root.goal,
      contextStrategy: "transcript_fallback" as const,
      modelId: root.model,
      providerId: "grok",
    };
    const turn1 = conv.appendTurn(input);
    const turn2 = conv.appendTurn(input);

    expect(turn2.id).toBe(turn1.id);
    expect(conv.listTurns(first.id)).toHaveLength(1);
  });

  it("idempotently keeps one assistant turn and an alternating transcript", () => {
    const root = tasks.create({ goal: "Build the page", workspaceRoots: [dir] });
    const conversation = conv.ensureForTask({ taskId: root.id });
    conv.appendTurn({
      conversationId: conversation.id,
      taskId: root.id,
      role: "user",
      content: root.goal,
    });
    const first = conv.appendTurn({
      conversationId: conversation.id,
      taskId: root.id,
      role: "assistant",
      content: "The page is ready.",
    });
    const duplicate = conv.appendTurn({
      conversationId: conversation.id,
      taskId: root.id,
      role: "assistant",
      content: "Duplicate completion.",
    });
    const child = tasks.create({
      goal: "Open it",
      workspaceRoots: [dir],
      parentTaskId: root.id,
    });
    conv.appendTurn({
      conversationId: conversation.id,
      taskId: child.id,
      role: "user",
      content: child.goal,
    });

    expect(duplicate.id).toBe(first.id);
    expect(
      conv.listTurns(conversation.id).map((turn) => [turn.role, turn.content]),
    ).toEqual([
      ["user", "Build the page"],
      ["assistant", "The page is ready."],
      ["user", "Open it"],
    ]);
  });

  it("authoritatively replaces a reconciled assistant turn and preserves chronology", () => {
    const root = tasks.create({ goal: "First question", workspaceRoots: [dir] });
    const conversation = conv.ensureForTask({ taskId: root.id });
    conv.appendTurn({
      conversationId: conversation.id,
      taskId: root.id,
      role: "user",
      content: root.goal,
      createdAt: "2026-08-05T10:00:00.000Z",
    });
    const provisional = conv.appendTurn({
      conversationId: conversation.id,
      taskId: root.id,
      role: "assistant",
      content: "Early answer",
      createdAt: "2026-08-05T10:00:01.000Z",
    });
    const corrected = conv.appendTurn({
      conversationId: conversation.id,
      taskId: root.id,
      role: "assistant",
      content: "Complete authoritative answer",
      createdAt: "2026-08-05T10:00:02.000Z",
      replaceExisting: true,
    });
    const child = tasks.create({
      goal: "Second question",
      workspaceRoots: [dir],
      parentTaskId: root.id,
    });
    conv.appendTurn({
      conversationId: conversation.id,
      taskId: child.id,
      role: "user",
      content: child.goal,
      createdAt: "2026-08-05T10:00:03.000Z",
    });

    expect(corrected.id).toBe(provisional.id);
    expect(
      conv.listTurns(conversation.id).map((turn) => [turn.role, turn.content]),
    ).toEqual([
      ["user", "First question"],
      ["assistant", "Complete authoritative answer"],
      ["user", "Second question"],
    ]);
  });

  it("requires the user turn to belong to the task's current conversation", () => {
    const root = tasks.create({ goal: "current context", workspaceRoots: [dir] });
    const oldConversation = conv.ensureForTask({ taskId: root.id });
    conv.appendTurn({
      conversationId: oldConversation.id,
      taskId: root.id,
      role: "user",
      content: root.goal,
    });
    const currentConversation = conv.create();
    conv.linkTask(root.id, currentConversation.id);

    expect(conv.hasUserTurn(root.id)).toBe(false);
  });

  it("buildTranscriptFallback prefers recent turns and bounds size", () => {
    const c = conv.create({ providerId: "grok" });
    for (let i = 0; i < 5; i++) {
      conv.appendTurn({
        conversationId: c.id,
        role: "user",
        content: `message-${i}-` + "x".repeat(100),
      });
    }
    const transcript = conv.buildTranscriptFallback(c.id, { maxChars: 400 });
    expect(transcript.length).toBeLessThanOrEqual(500);
    expect(transcript).toContain("message-4");
  });

  it("strictly bounds one oversized newest transcript block", () => {
    const c = conv.create({ providerId: "grok" });
    conv.appendTurn({
      conversationId: c.id,
      role: "user",
      content: "x".repeat(2_000),
    });
    const transcript = conv.buildTranscriptFallback(c.id, { maxChars: 128 });
    expect(transcript.length).toBeLessThanOrEqual(128);
  });

  it("cuts revision transcript history before the superseded source", () => {
    const c = conv.create({ providerId: "grok" });
    conv.appendTurn({
      conversationId: c.id,
      taskId: "root",
      role: "user",
      content: "root request",
    });
    conv.appendTurn({
      conversationId: c.id,
      taskId: "root",
      role: "assistant",
      content: "root answer",
    });
    conv.appendTurn({
      conversationId: c.id,
      taskId: "source",
      role: "user",
      content: "superseded request",
    });
    conv.appendTurn({
      conversationId: c.id,
      taskId: "revision",
      role: "user",
      content: "revised request",
    });

    const transcript = conv.buildTranscriptFallback(c.id, {
      throughTaskId: "root",
    });

    expect(transcript).toContain("root request");
    expect(transcript).toContain("root answer");
    expect(transcript).not.toContain("superseded request");
    expect(transcript).not.toContain("revised request");
  });

  it("transcript survives DB reopen (restart)", () => {
    const dbPath = path.join(dir, "persist.sqlite");
    const db1 = openDatabase(dbPath);
    const c1 = new ConversationService(db1);
    const conversation = c1.create();
    c1.appendTurn({
      conversationId: conversation.id,
      role: "user",
      content: "remember this across restart",
    });
    c1.appendTurn({
      conversationId: conversation.id,
      role: "assistant",
      content: "ack",
      providerSessionId: null,
      contextStrategy: "transcript_fallback",
    });
    db1.close();

    const db2 = openDatabase(dbPath);
    const c2 = new ConversationService(db2);
    const text = c2.buildTranscriptFallback(conversation.id);
    expect(text).toContain("remember this across restart");
    expect(text).toContain("ack");
    db2.close();
  });
});
