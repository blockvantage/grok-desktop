import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeTaskCreate } from "./task-create-flow.js";
import type { Task } from "@grokdesk/shared";
import { desktopRequestContext } from "./request-context.js";

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    goal: "do it",
    title: null,
    mode: "interactive",
    status: "queued",
    model: "m1",
    effort: "fast",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: ["/data/workspaces/c1"],
      allowShell: false,
      allowNetworkTools: false,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    attachments: [],
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: "t",
    updatedAt: "t",
    completedAt: null,
    ...over,
  };
}

describe("executeTaskCreate", () => {
  it("submits, receipts, binds conversation, runs memory, auto-titles root", () => {
    const created = task();
    const runWithMemory = vi.fn();
    const autoTitle = vi.fn();
    const appendSubmitReceipt = vi.fn();
    const upsertStandingMemory = vi.fn();
    const ensureForTask = vi.fn(() => ({ id: "conv" }));
    const appendTurn = vi.fn();

    const r = executeTaskCreate(
      {
        goal: "do it",
        workspaceRoots: [],
        model: "m1",
        approvalMode: "balanced",
        rolePack: "pack1",
      },
      desktopRequestContext("req-1"),
      {
        dataDir: "/data",
        resolveWorkspaceRoots: () => ["/data/workspaces/c1"],
        lookupRolePack: () => ({
          id: "pack1",
          name: "Pack",
          skills: ["s1"],
          defaultEffort: "heavy",
          standingInstructions: "stay sharp",
        }),
        upsertStandingMemory,
        submit: (input) => {
          expect(input.workspaceRoots).toEqual(["/data/workspaces/c1"]);
          expect(input.skills).toContain("s1");
          expect(input.effort).toBe("heavy");
          return {
            task: created,
            runAttempt: {
              id: "att-1",
              taskId: "t1",
              status: "queued",
              attemptNumber: 1,
              leaseOwner: null,
              leaseExpiresAt: null,
              startedAt: null,
              endedAt: null,
              terminalReason: null,
              providerSessionId: null,
              capabilitySnapshotJson: null,
              createdAt: "t",
            },
            principalId: "desktop",
            correlation: {
              requestId: "req-1",
              taskId: "t1",
              runAttemptId: "att-1",
            },
          };
        },
        appendSubmitReceipt,
        conversation: { ensureForTask, appendTurn },
        runWithMemory,
        autoTitle,
      },
      { effortWasExplicit: false },
    );

    expect(r.task.id).toBe("t1");
    expect(upsertStandingMemory).toHaveBeenCalled();
    expect(appendSubmitReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "t1",
        correlationId: "req-1",
        principalId: "desktop",
        runAttemptId: "att-1",
      }),
    );
    expect(appendSubmitReceipt.mock.calls[0]![0].detail).toMatchObject({
      requestId: "req-1",
      taskId: "t1",
      source: "desktop",
    });
    expect(ensureForTask).toHaveBeenCalled();
    expect(runWithMemory).toHaveBeenCalledWith("t1", {
      requestId: "req-1",
      runAttemptId: "att-1",
    });
    expect(autoTitle).toHaveBeenCalledWith("t1", "do it", "m1");
  });

  it("skips autoTitle for follow-up turns", () => {
    const autoTitle = vi.fn();
    const child = task({ parentTaskId: "parent" });
    executeTaskCreate(
      {
        goal: "follow",
        workspaceRoots: ["/ws"],
        model: "m1",
        approvalMode: "balanced",
        parentTaskId: "parent",
      },
      desktopRequestContext("r2"),
      {
        dataDir: "/data",
        resolveWorkspaceRoots: (p) => p.workspaceRoots,
        lookupRolePack: () => null,
        upsertStandingMemory: vi.fn(),
        submit: () => ({
          task: child,
          runAttempt: {
            id: "a",
            taskId: child.id,
            status: "queued",
            attemptNumber: 1,
            leaseOwner: null,
            leaseExpiresAt: null,
            startedAt: null,
            endedAt: null,
            terminalReason: null,
            providerSessionId: null,
            capabilitySnapshotJson: null,
            createdAt: "t",
          },
          principalId: "desktop",
          correlation: {
            requestId: "r2",
            taskId: child.id,
            runAttemptId: "a",
          },
        }),
        appendSubmitReceipt: vi.fn(),
        conversation: {
          ensureForTask: () => ({ id: "c" }),
          appendTurn: vi.fn(),
        },
        runWithMemory: vi.fn(),
        autoTitle,
      },
      { effortWasExplicit: true },
    );
    expect(autoTitle).not.toHaveBeenCalled();
  });

  it("rethrows attachment stage errors", () => {
    expect(() =>
      executeTaskCreate(
        {
          goal: "x",
          workspaceRoots: ["/data/workspaces/n"],
          model: "m",
          approvalMode: "balanced",
          attachments: [
            {
              id: "a",
              kind: "image",
              name: "x.png",
              sourcePath: "/nope",
              mimeType: "image/png",
              sizeBytes: 1,
            },
          ],
        },
        desktopRequestContext("r"),
        {
          dataDir: "/data",
          resolveWorkspaceRoots: () => ["/data/workspaces/n"],
          lookupRolePack: () => null,
          upsertStandingMemory: vi.fn(),
          submit: vi.fn(),
          appendSubmitReceipt: vi.fn(),
          conversation: {
            ensureForTask: vi.fn(),
            appendTurn: vi.fn(),
          },
          runWithMemory: vi.fn(),
          autoTitle: vi.fn(),
        },
      ),
    ).toThrow();
  });

  it("submits staged attachment metadata for durable task persistence", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-revision-"));
    const workspace = path.join(temp, "workspace");
    const sourcePath = path.join(temp, "brief.png");
    fs.mkdirSync(workspace);
    fs.writeFileSync(sourcePath, "image");
    const submit = vi.fn((input) => ({
      task: task({
        attachments: input.attachments ?? [],
      }),
      runAttempt: {
        id: "attempt-1",
        taskId: "task-1",
        status: "queued" as const,
        attemptNumber: 1,
        leaseOwner: null,
        leaseExpiresAt: null,
        startedAt: null,
        endedAt: null,
        terminalReason: null,
        providerSessionId: null,
        capabilitySnapshotJson: null,
        createdAt: "2026-07-15T12:00:00.000Z",
      },
      principalId: "desktop",
      correlation: {
        requestId: "request-1",
        taskId: "task-1",
        runAttemptId: "attempt-1",
      },
    }));
    const staged = {
      id: "attachment-1",
      kind: "image" as const,
      name: "brief.png",
      sourcePath,
      stagedPath: path.join(workspace, "attachments", "brief.png"),
      sizeBytes: 5,
    };

    executeTaskCreate(
      {
        goal: "Use the brief",
        workspaceRoots: [workspace],
        attachments: [staged],
      },
      desktopRequestContext("request-1"),
      {
        dataDir: "/data",
        resolveWorkspaceRoots: () => [workspace],
        lookupRolePack: () => null,
        upsertStandingMemory: vi.fn(),
        submit,
        appendSubmitReceipt: vi.fn(),
        conversation: {
          ensureForTask: () => ({ id: "conversation-1" }),
          appendTurn: vi.fn(),
        },
        runWithMemory: vi.fn(),
        autoTitle: vi.fn(),
      },
    );

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [expect.objectContaining({
          id: staged.id,
          sourcePath,
          stagedPath: expect.stringContaining(
            path.join(workspace, "attachments", path.sep),
          ),
        })],
      }),
      expect.anything(),
    );
    fs.rmSync(temp, { recursive: true, force: true });
  });

  it("leaves accepted work queued when its user turn cannot be bound", () => {
    const acceptedTask = task();
    const runWithMemory = vi.fn();
    executeTaskCreate(
      { goal: acceptedTask.goal, workspaceRoots: ["/ws"] },
      desktopRequestContext("bind-failure"),
      {
        dataDir: "/data",
        resolveWorkspaceRoots: () => ["/ws"],
        lookupRolePack: () => null,
        upsertStandingMemory: vi.fn(),
        submit: vi.fn(),
        acceptTaskCreate: () => ({
          kind: "fresh",
          resultTask: acceptedTask,
          acceptedTask,
          runAttempt: {
            id: "attempt-bind-failure",
            taskId: acceptedTask.id,
            status: "queued",
            attemptNumber: 1,
            leaseOwner: null,
            leaseExpiresAt: null,
            startedAt: null,
            endedAt: null,
            terminalReason: null,
            providerSessionId: null,
            capabilitySnapshotJson: null,
            createdAt: "t",
          },
          correlation: {
            requestId: "bind-failure",
            taskId: acceptedTask.id,
            runAttemptId: "attempt-bind-failure",
          },
        }),
        appendSubmitReceipt: vi.fn(),
        conversation: {
          ensureForTask: () => {
            throw new Error("conversation unavailable");
          },
          appendTurn: vi.fn(),
        },
        runWithMemory,
        autoTitle: vi.fn(),
      },
    );

    expect(runWithMemory).not.toHaveBeenCalled();
  });

  it("does not rematerialize attachments when a terminal duplicate is retried", () => {
    const terminal = task({ status: "done" });
    const finalizeAttachments = vi.fn();
    const ensureForTask = vi.fn(() => ({ id: "conversation" }));
    const runWithMemory = vi.fn();

    executeTaskCreate(
      { goal: terminal.goal, workspaceRoots: ["/ws"] },
      desktopRequestContext("terminal-duplicate"),
      {
        dataDir: "/data",
        resolveWorkspaceRoots: () => ["/ws"],
        lookupRolePack: () => null,
        upsertStandingMemory: vi.fn(),
        finalizeAttachments,
        submit: vi.fn(),
        acceptTaskCreate: () => ({
          kind: "duplicate",
          resultTask: terminal,
          acceptedTask: terminal,
          runAttempt: {
            id: "terminal-attempt",
            taskId: terminal.id,
            status: "done",
            attemptNumber: 1,
            leaseOwner: null,
            leaseExpiresAt: null,
            startedAt: "t",
            endedAt: "t",
            terminalReason: "done",
            providerSessionId: null,
            capabilitySnapshotJson: null,
            createdAt: "t",
          },
          correlation: {
            requestId: "terminal-duplicate",
            taskId: terminal.id,
            runAttemptId: "terminal-attempt",
          },
        }),
        appendSubmitReceipt: vi.fn(),
        conversation: { ensureForTask, appendTurn: vi.fn() },
        runWithMemory,
        autoTitle: vi.fn(),
      },
    );

    expect(finalizeAttachments).not.toHaveBeenCalled();
    expect(ensureForTask).toHaveBeenCalled();
    expect(runWithMemory).not.toHaveBeenCalled();
  });

  it("leaves no attachment artifacts when durable acceptance fails", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-accept-fail-"));
    const workspace = path.join(temp, "workspace");
    const sourcePath = path.join(temp, "photo.png");
    fs.mkdirSync(workspace);
    fs.writeFileSync(sourcePath, "image");

    expect(() =>
      executeTaskCreate(
        {
          goal: "must not contaminate parent",
          workspaceRoots: [workspace],
          parentTaskId: "parent",
          attachments: [
            {
              id: "photo-id",
              kind: "image",
              name: "photo.png",
              sourcePath,
              sizeBytes: 5,
            },
          ],
        },
        desktopRequestContext("accept-failure"),
        {
          dataDir: temp,
          resolveWorkspaceRoots: () => [workspace],
          lookupRolePack: () => null,
          upsertStandingMemory: vi.fn(),
          submit: vi.fn(),
          acceptTaskCreate: () => {
            throw new Error("revision validation failed");
          },
          appendSubmitReceipt: vi.fn(),
          conversation: {
            ensureForTask: vi.fn(),
            appendTurn: vi.fn(),
          },
          runWithMemory: vi.fn(),
          autoTitle: vi.fn(),
        },
      ),
    ).toThrow("revision validation failed");
    expect(fs.existsSync(path.join(workspace, "attachments"))).toBe(false);
    fs.rmSync(temp, { recursive: true, force: true });
  });

  it("removes an empty managed workspace when acceptance fails", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-orphan-fail-"));
    const workspace = path.join(dataDir, "workspaces", "grok-chat-ABC123");
    fs.mkdirSync(workspace, { recursive: true });

    expect(() =>
      executeTaskCreate(
        { goal: "never accepted" },
        desktopRequestContext("orphan-failure"),
        {
          dataDir,
          resolveWorkspaceRoots: () => [workspace],
          lookupRolePack: () => null,
          upsertStandingMemory: vi.fn(),
          submit: vi.fn(),
          acceptTaskCreate: () => {
            throw new Error("acceptance failed");
          },
          appendSubmitReceipt: vi.fn(),
          conversation: {
            ensureForTask: vi.fn(),
            appendTurn: vi.fn(),
          },
          runWithMemory: vi.fn(),
          autoTitle: vi.fn(),
        },
      ),
    ).toThrow("acceptance failed");

    expect(fs.existsSync(workspace)).toBe(false);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("removes the speculative root created before a duplicate is rehydrated", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-orphan-duplicate-"));
    const speculative = path.join(dataDir, "workspaces", "grok-chat-ABC123");
    const durableRoot = path.join(dataDir, "workspaces", "grok-chat-DEF456");
    fs.mkdirSync(speculative, { recursive: true });
    fs.mkdirSync(durableRoot, { recursive: true });
    const duplicate = task({
      policySnapshot: {
        approvalMode: "balanced",
        workspaceRoots: [durableRoot],
        allowShell: false,
        allowNetworkTools: false,
      },
    });

    executeTaskCreate(
      { goal: duplicate.goal, clientMutationId: "already-accepted" },
      desktopRequestContext("duplicate-orphan"),
      {
        dataDir,
        resolveWorkspaceRoots: () => [speculative],
        lookupRolePack: () => null,
        upsertStandingMemory: vi.fn(),
        submit: vi.fn(),
        acceptTaskCreate: () => ({
          kind: "duplicate",
          resultTask: duplicate,
          acceptedTask: duplicate,
          runAttempt: {
            id: "duplicate-attempt",
            taskId: duplicate.id,
            status: "queued",
            attemptNumber: 1,
            leaseOwner: null,
            leaseExpiresAt: null,
            startedAt: null,
            endedAt: null,
            terminalReason: null,
            providerSessionId: null,
            capabilitySnapshotJson: null,
            createdAt: "t",
          },
          correlation: {
            requestId: "duplicate-orphan",
            taskId: duplicate.id,
            runAttemptId: "duplicate-attempt",
          },
        }),
        appendSubmitReceipt: vi.fn(),
        conversation: {
          ensureForTask: () => ({ id: "conversation" }),
          appendTurn: vi.fn(),
        },
        runWithMemory: vi.fn(),
        autoTitle: vi.fn(),
      },
    );

    expect(fs.existsSync(speculative)).toBe(false);
    expect(fs.existsSync(durableRoot)).toBe(true);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("never removes a non-empty managed workspace after a failed acceptance", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-orphan-safe-"));
    const workspace = path.join(dataDir, "workspaces", "grok-chat-ABC123");
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, "keep.txt"), "keep");

    expect(() =>
      executeTaskCreate(
        { goal: "failed but preserve unexpected data" },
        desktopRequestContext("orphan-safe"),
        {
          dataDir,
          resolveWorkspaceRoots: () => [workspace],
          lookupRolePack: () => null,
          upsertStandingMemory: vi.fn(),
          submit: vi.fn(),
          acceptTaskCreate: () => {
            throw new Error("acceptance failed");
          },
          appendSubmitReceipt: vi.fn(),
          conversation: {
            ensureForTask: vi.fn(),
            appendTurn: vi.fn(),
          },
          runWithMemory: vi.fn(),
          autoTitle: vi.fn(),
        },
      ),
    ).toThrow("acceptance failed");

    expect(fs.readFileSync(path.join(workspace, "keep.txt"), "utf8")).toBe("keep");
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
