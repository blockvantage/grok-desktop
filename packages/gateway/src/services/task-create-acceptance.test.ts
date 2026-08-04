import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { MutationReceiptService } from "./mutation-receipts.js";
import { OperationReceiptService } from "./operation-receipts.js";
import { RunAttemptService } from "./run-attempts.js";
import { TaskCreateAcceptanceService } from "./task-create-acceptance.js";
import { TaskSubmissionService } from "./task-submission.js";
import { TaskService } from "./tasks.js";
import { desktopRequestContext } from "./request-context.js";

function buildAcceptance(db: Db): TaskCreateAcceptanceService {
  const tasks = new TaskService(db);
  const attempts = new RunAttemptService(db, "test-instance");
  return new TaskCreateAcceptanceService({
    tasks,
    runAttempts: attempts,
    submissions: new TaskSubmissionService(tasks, attempts),
    mutationReceipts: new MutationReceiptService(db),
    operationReceipts: new OperationReceiptService(db),
  });
}

describe("tasks.create crash-atomic acceptance", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-create-accept-"));
    dbPath = path.join(dir, "gateway.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reopens after acceptance-before-kick and returns the one durable task", () => {
    const params = {
      goal: "survive the crash",
      workspaceRoots: [dir],
      clientMutationId: "mutation-1",
    };
    const mutation = {
      principalId: "desktop",
      method: "tasks.create" as const,
      clientMutationId: params.clientMutationId,
      params,
    };

    const db1 = openDatabase(dbPath);
    const first = buildAcceptance(db1).accept(
      params,
      desktopRequestContext("request-before-crash"),
      mutation,
    );
    expect(first.kind).toBe("fresh");
    // Simulate an unclean process boundary immediately after the synchronous
    // acceptance commit: no conversation bind and no queue kick happened.
    db1.close();

    const db2 = openDatabase(dbPath);
    const second = buildAcceptance(db2).accept(
      params,
      desktopRequestContext("request-after-restart"),
      mutation,
    );

    expect(second.kind).toBe("duplicate");
    expect(second.resultTask.id).toBe(first.resultTask.id);
    expect(second.acceptedTask.id).toBe(first.resultTask.id);
    expect(second.runAttempt.id).toBe(first.runAttempt.id);
    expect(
      db2.prepare("SELECT COUNT(*) AS n FROM tasks").get(),
    ).toEqual({ n: 1 });
    expect(
      db2.prepare("SELECT COUNT(*) AS n FROM task_run_attempts").get(),
    ).toEqual({ n: 1 });
    expect(
      db2.prepare("SELECT COUNT(*) AS n FROM mutation_receipts").get(),
    ).toEqual({ n: 1 });
    expect(
      db2
        .prepare(
          "SELECT COUNT(*) AS n FROM operation_receipts WHERE action = 'task.submit'",
        )
        .get(),
    ).toEqual({ n: 1 });
    expect(second.acceptedTask.status).toBe("queued");
    db2.close();
  });

  it("rolls the task and attempt back when acceptance cannot write its receipt", () => {
    const db = openDatabase(dbPath);
    const mutationReceipts = new MutationReceiptService(db);
    const originalCommit = mutationReceipts.commit.bind(mutationReceipts);
    mutationReceipts.commit = () => {
      throw new Error("simulated receipt write failure");
    };
    const tasks = new TaskService(db);
    const attempts = new RunAttemptService(db, "test-instance");
    const acceptance = new TaskCreateAcceptanceService({
      tasks,
      runAttempts: attempts,
      submissions: new TaskSubmissionService(tasks, attempts),
      mutationReceipts,
      operationReceipts: new OperationReceiptService(db),
    });

    expect(() =>
      acceptance.accept(
        { goal: "rollback", workspaceRoots: [dir] },
        desktopRequestContext("request-rollback"),
        {
          principalId: "desktop",
          method: "tasks.create",
          clientMutationId: "mutation-rollback",
          params: {
            goal: "rollback",
            workspaceRoots: [dir],
            clientMutationId: "mutation-rollback",
          },
        },
      ),
    ).toThrow("simulated receipt write failure");

    expect(db.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM task_run_attempts").get(),
    ).toEqual({ n: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM task_events").get(),
    ).toEqual({ n: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM operation_receipts").get(),
    ).toEqual({ n: 0 });
    mutationReceipts.commit = originalCommit;
    db.close();
  });

  it("keeps task, attempt, and submit receipt atomic without a client mutation id", () => {
    const db = openDatabase(dbPath);
    const tasks = new TaskService(db);
    const attempts = new RunAttemptService(db, "test-instance");
    const operationReceipts = new OperationReceiptService(db);
    operationReceipts.append = () => {
      throw new Error("simulated submit receipt failure");
    };
    const acceptance = new TaskCreateAcceptanceService({
      tasks,
      runAttempts: attempts,
      submissions: new TaskSubmissionService(tasks, attempts),
      mutationReceipts: new MutationReceiptService(db),
      operationReceipts,
    });

    expect(() =>
      acceptance.accept(
        { goal: "legacy caller", workspaceRoots: [dir] },
        desktopRequestContext("legacy-request"),
      ),
    ).toThrow("simulated submit receipt failure");
    expect(db.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM task_run_attempts").get(),
    ).toEqual({ n: 0 });
    db.close();
  });

  it("emits task hooks only after the acceptance receipt commits", () => {
    const db = openDatabase(dbPath);
    const onTasksChanged = vi.fn();
    const onTaskEvent = vi.fn();
    const tasks = new TaskService(db, { onTasksChanged, onTaskEvent });
    const attempts = new RunAttemptService(db, "test-instance");
    const mutationReceipts = new MutationReceiptService(db);
    const originalCommit = mutationReceipts.commit.bind(mutationReceipts);
    mutationReceipts.commit = (...args) => {
      expect(onTasksChanged).not.toHaveBeenCalled();
      expect(onTaskEvent).not.toHaveBeenCalled();
      return originalCommit(...args);
    };
    const acceptance = new TaskCreateAcceptanceService({
      tasks,
      runAttempts: attempts,
      submissions: new TaskSubmissionService(tasks, attempts),
      mutationReceipts,
      operationReceipts: new OperationReceiptService(db),
    });

    acceptance.accept(
      { goal: "notify after commit", workspaceRoots: [dir] },
      desktopRequestContext("notify-request"),
      {
        principalId: "desktop",
        method: "tasks.create",
        clientMutationId: "notify-mutation",
        params: {
          goal: "notify after commit",
          workspaceRoots: [dir],
          clientMutationId: "notify-mutation",
        },
      },
    );

    expect(onTasksChanged).toHaveBeenCalledTimes(1);
    expect(onTaskEvent).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("rejects a conflicting retry without accepting another revision", () => {
    const db = openDatabase(dbPath);
    const acceptance = buildAcceptance(db);
    const ctx = desktopRequestContext("request-revision");
    const source = acceptance.accept(
      { goal: "source", workspaceRoots: [dir] },
      ctx,
      {
        principalId: "desktop",
        method: "tasks.create",
        clientMutationId: "source-mutation",
        params: { goal: "source", workspaceRoots: [dir] },
      },
    );
    db.prepare(
      "UPDATE tasks SET status = 'done', completed_at = updated_at WHERE id = ?",
    ).run(source.resultTask.id);

    const revisionParams = {
      goal: "edited source",
      workspaceRoots: [dir],
      parentTaskId: source.resultTask.id,
      revisionOfTaskId: source.resultTask.id,
    };
    const key = {
      principalId: "desktop",
      method: "tasks.create" as const,
      clientMutationId: "revision-mutation",
      params: { ...revisionParams, clientMutationId: "revision-mutation" },
    };
    const revision = acceptance.accept(revisionParams, ctx, key);
    const duplicate = acceptance.accept(revisionParams, ctx, key);
    expect(duplicate.kind).toBe("duplicate");
    expect(duplicate.resultTask.id).toBe(revision.resultTask.id);

    expect(() =>
      acceptance.accept(
        { ...revisionParams, goal: "different edit" },
        ctx,
        {
          ...key,
          params: {
            ...key.params,
            goal: "different edit",
          },
        },
      ),
    ).toThrow("clientMutationId reused with different payload");
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE revision_of_task_id = ?")
        .get(source.resultTask.id),
    ).toEqual({ n: 1 });
    db.close();
  });
});
