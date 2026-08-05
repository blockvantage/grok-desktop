import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { TestEngine } from "@grokdesk/engine-testkit";
import { Gateway } from "../index.js";
import { openDatabase } from "../db.js";
import { MutationReceiptService } from "../services/mutation-receipts.js";
import { OperationReceiptService } from "../services/operation-receipts.js";
import { RunAttemptService } from "../services/run-attempts.js";
import { TaskCreateAcceptanceService } from "../services/task-create-acceptance.js";
import { TaskSubmissionService } from "../services/task-submission.js";
import { TaskService } from "../services/tasks.js";
import { desktopRequestContext } from "../services/request-context.js";

describe("tasks.create acceptance recovery through Gateway", () => {
  let dir: string;
  let dbPath: string;
  let gateway: Gateway | null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-create-recover-"));
    dbPath = path.join(dir, "gateway.sqlite");
    gateway = null;
  });

  afterEach(async () => {
    await gateway?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reconciles a committed acceptance with no client retry after restart", async () => {
    const params = {
      goal: "resume me after commit",
      workspaceRoots: [dir],
      clientMutationId: "restart-mutation",
      rolePack: "research",
    };
    const seedDb = openDatabase(dbPath);
    const tasks = new TaskService(seedDb);
    const attempts = new RunAttemptService(seedDb, "crashed-instance");
    const accepted = new TaskCreateAcceptanceService({
      tasks,
      runAttempts: attempts,
      submissions: new TaskSubmissionService(tasks, attempts),
      mutationReceipts: new MutationReceiptService(seedDb),
      operationReceipts: new OperationReceiptService(seedDb),
    }).accept(
      params,
      desktopRequestContext("request-before-crash"),
      {
        principalId: "desktop",
        method: "tasks.create",
        clientMutationId: params.clientMutationId,
        params,
      },
    );
    expect(
      seedDb.prepare("SELECT COUNT(*) AS n FROM turns").get(),
    ).toEqual({ n: 0 });
    seedDb.close();

    gateway = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "restarted" },
    );
    await gateway.start();

    for (let i = 0; i < 40; i += 1) {
      if (gateway.tasks.get(accepted.resultTask.id)?.status === "done") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(gateway.tasks.get(accepted.resultTask.id)?.status).toBe("done");

    const inspect = openDatabase(dbPath);
    const counts = inspect
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM tasks) AS tasks,
          (SELECT COUNT(*) FROM task_run_attempts) AS attempts,
          (SELECT COUNT(*) FROM turns WHERE task_id = ?) AS turns,
          (SELECT COUNT(*) FROM mutation_receipts) AS mutations,
          (SELECT COUNT(*) FROM operation_receipts WHERE action = 'task.submit') AS submits,
          (SELECT COUNT(*) FROM memory_items WHERE id = 'role-pack:research') AS standingMemory`,
      )
      .get(accepted.resultTask.id) as Record<string, number>;
    expect(counts).toEqual({
      tasks: 1,
      attempts: 1,
      // The recovered accepted input and its reconciled assistant final are
      // both durable after restart.
      turns: 2,
      mutations: 1,
      submits: 1,
      standingMemory: 1,
    });
    inspect.close();
  });

  it("routes a duplicate retry through reconciliation and returns the original task", async () => {
    const params = {
      goal: "retry after crash",
      workspaceRoots: [dir],
      clientMutationId: "duplicate-mutation",
    };
    const seedDb = openDatabase(dbPath);
    const tasks = new TaskService(seedDb);
    const attempts = new RunAttemptService(seedDb, "crashed-instance");
    const first = new TaskCreateAcceptanceService({
      tasks,
      runAttempts: attempts,
      submissions: new TaskSubmissionService(tasks, attempts),
      mutationReceipts: new MutationReceiptService(seedDb),
      operationReceipts: new OperationReceiptService(seedDb),
    }).accept(params, desktopRequestContext("before"), {
      principalId: "desktop",
      method: "tasks.create",
      clientMutationId: params.clientMutationId,
      params,
    });
    seedDb.close();

    gateway = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "retry-instance" },
    );
    await gateway.start();
    const retried = (await gateway.handle({
      id: "after",
      method: "tasks.create",
      params,
    })) as { id: string };
    expect(retried.id).toBe(first.resultTask.id);

    const inspect = openDatabase(dbPath);
    expect(
      inspect
        .prepare("SELECT COUNT(*) AS n FROM turns WHERE task_id = ? AND role = 'user'")
        .get(first.resultTask.id),
    ).toEqual({ n: 1 });
    expect(inspect.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({
      n: 1,
    });
    inspect.close();
  });

  it("reconciles an unbound thread root-first so follow-ups share one conversation", async () => {
    const seedDb = openDatabase(dbPath);
    const tasks = new TaskService(seedDb);
    const attempts = new RunAttemptService(seedDb, "crashed-instance");
    const acceptance = new TaskCreateAcceptanceService({
      tasks,
      runAttempts: attempts,
      submissions: new TaskSubmissionService(tasks, attempts),
      mutationReceipts: new MutationReceiptService(seedDb),
      operationReceipts: new OperationReceiptService(seedDb),
    });
    const root = acceptance.accept(
      { goal: "thread root", workspaceRoots: [dir] },
      desktopRequestContext("root-request"),
      {
        principalId: "desktop",
        method: "tasks.create",
        clientMutationId: "root-mutation",
        params: { goal: "thread root", workspaceRoots: [dir] },
      },
    ).resultTask;
    const child = acceptance.accept(
      {
        goal: "thread follow-up",
        workspaceRoots: [dir],
        parentTaskId: root.id,
      },
      desktopRequestContext("child-request"),
      {
        principalId: "desktop",
        method: "tasks.create",
        clientMutationId: "child-mutation",
        params: {
          goal: "thread follow-up",
          workspaceRoots: [dir],
          parentTaskId: root.id,
        },
      },
    ).resultTask;
    seedDb.close();

    gateway = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "thread-recovery" },
    );
    await gateway.start();

    const inspect = openDatabase(dbPath);
    const rows = inspect
      .prepare("SELECT id, conversation_id AS conversationId FROM tasks WHERE id IN (?, ?)")
      .all(root.id, child.id) as Array<{
        id: string;
        conversationId: string | null;
      }>;
    const byId = new Map(rows.map((row) => [row.id, row.conversationId]));
    expect(byId.get(root.id)).toBeTruthy();
    expect(byId.get(child.id)).toBe(byId.get(root.id));
    expect(
      inspect
        .prepare("SELECT COUNT(*) AS n FROM turns WHERE conversation_id = ? AND role = 'user'")
        .get(byId.get(root.id)),
    ).toEqual({ n: 2 });
    inspect.close();
  });

  it("keeps a bind failure queued and runs it after queued reconciliation retries", async () => {
    gateway = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "transient-bind" },
    );
    await gateway.start();
    const ensure = gateway.conversations.ensureForTask.bind(
      gateway.conversations,
    );
    let failOnce = true;
    gateway.conversations.ensureForTask = (input) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("transient conversation failure");
      }
      return ensure(input);
    };

    const task = (await gateway.handle({
      id: "transient-request",
      method: "tasks.create",
      params: {
        goal: "wait for the durable turn",
        workspaceRoots: [dir],
        clientMutationId: "transient-mutation",
      },
    })) as { id: string };
    expect(gateway.tasks.get(task.id)?.status).toBe("queued");
    expect(gateway.conversations.hasUserTurn(task.id)).toBe(false);

    const recovery = gateway as unknown as {
      reconcileQueuedTaskEffects(): void;
    };
    recovery.reconcileQueuedTaskEffects();
    await gateway.runner.pumpQueue();

    expect(gateway.tasks.get(task.id)?.status).toBe("done");
    expect(gateway.conversations.hasUserTurn(task.id)).toBe(true);
  });

  it("finalizes accepted attachment plans after restart exactly once", async () => {
    const workspace = path.join(dir, "attachment-workspace");
    const sourcePath = path.join(dir, "photo.png");
    const stagedPath = path.join(
      workspace,
      "attachments",
      "photo-id-photo.png",
    );
    fs.mkdirSync(workspace);
    fs.writeFileSync(sourcePath, "image-bytes");
    const seedDb = openDatabase(dbPath);
    const tasks = new TaskService(seedDb);
    const attempts = new RunAttemptService(seedDb, "crashed-instance");
    const accepted = new TaskCreateAcceptanceService({
      tasks,
      runAttempts: attempts,
      submissions: new TaskSubmissionService(tasks, attempts),
      mutationReceipts: new MutationReceiptService(seedDb),
      operationReceipts: new OperationReceiptService(seedDb),
    }).accept(
      {
        goal: "use the accepted photo",
        workspaceRoots: [workspace],
        attachments: [
          {
            id: "photo-id",
            kind: "image",
            name: "photo.png",
            sourcePath,
            stagedPath,
            sizeBytes: 11,
          },
        ],
      },
      desktopRequestContext("attachment-before-crash"),
      {
        principalId: "desktop",
        method: "tasks.create",
        clientMutationId: "attachment-mutation",
        params: {
          goal: "use the accepted photo",
          workspaceRoots: [workspace],
          clientMutationId: "attachment-mutation",
        },
      },
    );
    seedDb.close();
    expect(fs.existsSync(stagedPath)).toBe(false);

    gateway = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "attachment-recovery" },
    );
    await gateway.start();
    for (let i = 0; i < 40; i += 1) {
      if (gateway.tasks.get(accepted.resultTask.id)?.status === "done") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(fs.readFileSync(stagedPath, "utf8")).toBe("image-bytes");
    const manifestPath = path.join(workspace, "attachments", "manifest.json");
    expect(JSON.parse(fs.readFileSync(manifestPath, "utf8"))).toHaveLength(1);

    await gateway.stop();
    gateway = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "attachment-reopen" },
    );
    await gateway.start();
    expect(JSON.parse(fs.readFileSync(manifestPath, "utf8"))).toHaveLength(1);
  });

  it("does not bypass attachment readiness for noninteractive tasks.create", async () => {
    const workspace = path.join(dir, "scheduled-attachment-workspace");
    fs.mkdirSync(workspace);
    const missingSource = path.join(dir, "missing.png");
    const missingStaged = path.join(
      workspace,
      "attachments",
      "missing-photo.png",
    );
    const seedDb = openDatabase(dbPath);
    const tasks = new TaskService(seedDb);
    const attempts = new RunAttemptService(seedDb, "crashed-instance");
    const accepted = new TaskCreateAcceptanceService({
      tasks,
      runAttempts: attempts,
      submissions: new TaskSubmissionService(tasks, attempts),
      mutationReceipts: new MutationReceiptService(seedDb),
      operationReceipts: new OperationReceiptService(seedDb),
    }).accept(
      {
        goal: "scheduled API create with missing accepted bytes",
        mode: "scheduled",
        workspaceRoots: [workspace],
        attachments: [
          {
            id: "missing-photo",
            kind: "image",
            name: "missing.png",
            sourcePath: missingSource,
            stagedPath: missingStaged,
            sizeBytes: 10,
            contentSha256: "0".repeat(64),
          },
        ],
      },
      desktopRequestContext("scheduled-attachment"),
      {
        principalId: "desktop",
        method: "tasks.create",
        clientMutationId: "scheduled-attachment-mutation",
        params: {
          goal: "scheduled API create with missing accepted bytes",
          clientMutationId: "scheduled-attachment-mutation",
        },
      },
    );
    seedDb.close();

    gateway = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "scheduled-attachment" },
    );
    await gateway.start();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(gateway.tasks.get(accepted.resultTask.id)?.status).toBe("queued");
    expect(fs.existsSync(missingStaged)).toBe(false);
  });

  it("reconciles terminal history without restoring or requiring old attachment bytes", async () => {
    const workspace = path.join(dir, "terminal-history-workspace");
    const restorableSource = path.join(dir, "old-photo.png");
    const restorableStaged = path.join(workspace, "attachments", "old-photo.png");
    const missingSource = path.join(dir, "deleted-photo.png");
    const missingStaged = path.join(workspace, "attachments", "deleted-photo.png");
    const bytes = Buffer.from("old-image-bytes");
    fs.mkdirSync(workspace);
    fs.writeFileSync(restorableSource, bytes);

    const seedDb = openDatabase(dbPath);
    const tasks = new TaskService(seedDb);
    const attempts = new RunAttemptService(seedDb, "crashed-instance");
    const acceptance = new TaskCreateAcceptanceService({
      tasks,
      runAttempts: attempts,
      submissions: new TaskSubmissionService(tasks, attempts),
      mutationReceipts: new MutationReceiptService(seedDb),
      operationReceipts: new OperationReceiptService(seedDb),
    });
    const root = acceptance.accept(
      {
        goal: "completed history with old attachments",
        workspaceRoots: [workspace],
        rolePack: "research",
        attachments: [
          {
            id: "old-photo",
            kind: "image",
            name: "old-photo.png",
            sourcePath: restorableSource,
            stagedPath: restorableStaged,
            sizeBytes: bytes.byteLength,
            contentSha256: createHash("sha256").update(bytes).digest("hex"),
          },
          {
            id: "deleted-photo",
            kind: "image",
            name: "deleted-photo.png",
            sourcePath: missingSource,
            stagedPath: missingStaged,
            sizeBytes: 10,
            contentSha256: "0".repeat(64),
          },
        ],
      },
      desktopRequestContext("terminal-root"),
    ).resultTask;
    tasks.setStatus(root.id, "done");
    const child = acceptance.accept(
      {
        goal: "continue the historical thread",
        workspaceRoots: [workspace],
        parentTaskId: root.id,
      },
      desktopRequestContext("terminal-child"),
    ).resultTask;
    seedDb.close();

    gateway = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "terminal-history-recovery" },
    );
    await gateway.start();

    const inspect = openDatabase(dbPath);
    const rows = inspect
      .prepare("SELECT id, conversation_id AS conversationId FROM tasks WHERE id IN (?, ?)")
      .all(root.id, child.id) as Array<{
        id: string;
        conversationId: string | null;
      }>;
    const byId = new Map(rows.map((row) => [row.id, row.conversationId]));
    expect(byId.get(root.id)).toBeTruthy();
    expect(byId.get(child.id)).toBe(byId.get(root.id));
    expect(
      inspect
        .prepare("SELECT COUNT(*) AS n FROM memory_items WHERE id = 'role-pack:research'")
        .get(),
    ).toEqual({ n: 1 });
    expect(fs.existsSync(restorableStaged)).toBe(false);
    expect(fs.existsSync(missingStaged)).toBe(false);
    inspect.close();
  });

  it("fails truthfully after bounded attachment recovery attempts", async () => {
    const workspace = path.join(dir, "unrecoverable-attachment-workspace");
    const missingSource = path.join(dir, "deleted-before-finalization.png");
    const missingStaged = path.join(workspace, "attachments", "missing.png");
    fs.mkdirSync(workspace);
    const seedDb = openDatabase(dbPath);
    const tasks = new TaskService(seedDb);
    const attempts = new RunAttemptService(seedDb, "crashed-instance");
    const accepted = new TaskCreateAcceptanceService({
      tasks,
      runAttempts: attempts,
      submissions: new TaskSubmissionService(tasks, attempts),
      mutationReceipts: new MutationReceiptService(seedDb),
      operationReceipts: new OperationReceiptService(seedDb),
    }).accept(
      {
        goal: "use an attachment whose accepted bytes disappeared",
        workspaceRoots: [workspace],
        attachments: [{
          id: "missing-photo",
          kind: "image",
          name: "missing.png",
          sourcePath: missingSource,
          stagedPath: missingStaged,
          sizeBytes: 10,
          contentSha256: "0".repeat(64),
        }],
      },
      desktopRequestContext("missing-attachment-before-crash"),
    );
    seedDb.close();

    gateway = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "missing-attachment-recovery" },
    );
    await gateway.start();
    const recovery = gateway as unknown as {
      reconcileQueuedTaskEffects(): void;
    };
    recovery.reconcileQueuedTaskEffects();
    recovery.reconcileQueuedTaskEffects();

    const recovered = gateway.tasks.get(accepted.resultTask.id);
    expect(recovered?.status).toBe("failed");
    expect(gateway.runAttempts.latestForTask(accepted.resultTask.id)).toMatchObject({
      status: "failed",
      terminalReason: "attachment_recovery_failed",
    });
    expect(
      gateway.tasks
        .listEvents(accepted.resultTask.id)
        .find((event) => event.kind === "error"),
    ).toMatchObject({
      payload: {
        code: "attachment_recovery_failed",
        recoverable: true,
      },
    });
    expect(fs.existsSync(missingStaged)).toBe(false);
  });

  it("resumes a queued turn when accepted attachment bytes return within the retry budget", async () => {
    const workspace = path.join(dir, "transient-attachment-workspace");
    const sourcePath = path.join(dir, "temporarily-missing.png");
    const stagedPath = path.join(workspace, "attachments", "restored.png");
    const bytes = Buffer.from("restored-bytes");
    fs.mkdirSync(workspace);
    const seedDb = openDatabase(dbPath);
    const tasks = new TaskService(seedDb);
    const attempts = new RunAttemptService(seedDb, "crashed-instance");
    const accepted = new TaskCreateAcceptanceService({
      tasks,
      runAttempts: attempts,
      submissions: new TaskSubmissionService(tasks, attempts),
      mutationReceipts: new MutationReceiptService(seedDb),
      operationReceipts: new OperationReceiptService(seedDb),
    }).accept(
      {
        goal: "recover the temporarily unavailable attachment",
        workspaceRoots: [workspace],
        attachments: [{
          id: "restored-photo",
          kind: "image",
          name: "restored.png",
          sourcePath,
          stagedPath,
          sizeBytes: bytes.byteLength,
          contentSha256: createHash("sha256").update(bytes).digest("hex"),
        }],
      },
      desktopRequestContext("transient-attachment-before-crash"),
    );
    seedDb.close();

    gateway = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "transient-attachment-recovery" },
    );
    await gateway.start();
    expect(gateway.tasks.get(accepted.resultTask.id)?.status).toBe("queued");
    fs.writeFileSync(sourcePath, bytes);
    const recovery = gateway as unknown as {
      reconcileQueuedTaskEffects(): void;
    };
    recovery.reconcileQueuedTaskEffects();
    await gateway.runner.pumpQueue();

    expect(gateway.tasks.get(accepted.resultTask.id)?.status).toBe("done");
    expect(fs.readFileSync(stagedPath)).toEqual(bytes);
    expect(
      gateway.tasks
        .listEvents(accepted.resultTask.id)
        .some(
          (event) =>
            event.payload.code === "attachment_recovery_succeeded",
        ),
    ).toBe(true);
  });
});
