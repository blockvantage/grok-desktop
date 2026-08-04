import type { CreateTaskInput, Task } from "@grokdesk/shared";
import {
  newRequestCorrelation,
  withRunAttempt,
  withTask,
  type CorrelationChain,
} from "@grokdesk/shared";
import type { MutationReceiptService } from "./mutation-receipts.js";
import type { OperationReceiptService } from "./operation-receipts.js";
import type { RequestContext } from "./request-context.js";
import type { RunAttempt, RunAttemptService } from "./run-attempts.js";
import type {
  SubmitTaskResult,
  TaskSubmissionService,
} from "./task-submission.js";
import type { TaskService } from "./tasks.js";
import {
  chainFromIds,
  stampDetailWithCorrelation,
} from "./correlation-stamp.js";

export interface TaskCreateMutationKey {
  principalId: string;
  method: "tasks.create";
  clientMutationId: string;
  params: unknown;
}

export interface AcceptedTaskCreate {
  kind: "fresh" | "duplicate";
  /** Original stable result returned for this mutation id. */
  resultTask: Task;
  /** Current durable row used to safely resume post-commit effects. */
  acceptedTask: Task;
  runAttempt: RunAttempt;
  correlation: CorrelationChain;
}

/**
 * The durable acceptance boundary for tasks.create.
 *
 * Task row, queued event, run attempt, task.submit operation receipt, and
 * mutation receipt are committed together. Conversation binding and queue
 * execution intentionally live outside this service, after this method
 * returns, so externally visible work never starts for a rolled-back task.
 */
export class TaskCreateAcceptanceService {
  constructor(
    private deps: {
      tasks: TaskService;
      runAttempts: RunAttemptService;
      submissions: TaskSubmissionService;
      mutationReceipts: MutationReceiptService;
      operationReceipts: OperationReceiptService;
    },
  ) {}

  accept(
    input: CreateTaskInput,
    requestCtx: RequestContext,
    mutation?: TaskCreateMutationKey,
  ): AcceptedTaskCreate {
    let freshSubmission: SubmitTaskResult | null = null;
    const create = (): Task => {
      const submission = this.deps.submissions.submit(input, requestCtx, {
        deferTaskHooks: true,
      });
      freshSubmission = submission;
      this.appendSubmitReceipt(submission, requestCtx);
      return submission.task;
    };

    if (!mutation) {
      const resultTask = this.deps.mutationReceipts.runAtomically(create);
      const accepted = this.fromFresh(resultTask, freshSubmission!);
      this.emitCommittedTask(accepted.acceptedTask.id);
      return accepted;
    }

    const accepted = this.deps.mutationReceipts.acceptAtomically(
      mutation.principalId,
      mutation.method,
      mutation.clientMutationId,
      mutation.params,
      create,
    );
    if (accepted.kind === "fresh") {
      const result = this.fromFresh(accepted.result, freshSubmission!);
      this.emitCommittedTask(result.acceptedTask.id);
      return result;
    }

    return this.resume(accepted.result, requestCtx);
  }

  /** Rehydrate a committed acceptance without creating any new durable row. */
  resume(result: unknown, requestCtx: RequestContext): AcceptedTaskCreate {
    const resultTask = this.readTaskResult(result);
    const acceptedTask = this.deps.tasks.get(resultTask.id);
    const runAttempt = this.deps.runAttempts.latestForTask(resultTask.id);
    if (!acceptedTask || !runAttempt) {
      throw new Error(
        "tasks.create receipt refers to an incomplete durable acceptance",
      );
    }
    return {
      kind: "duplicate",
      resultTask,
      acceptedTask,
      runAttempt,
      correlation: this.correlation(
        requestCtx.requestId,
        acceptedTask.id,
        runAttempt.id,
      ),
    };
  }

  private fromFresh(
    resultTask: Task,
    submission: SubmitTaskResult,
  ): AcceptedTaskCreate {
    return {
      kind: "fresh",
      resultTask,
      acceptedTask: submission.task,
      runAttempt: submission.runAttempt,
      correlation: submission.correlation,
    };
  }

  private emitCommittedTask(taskId: string): void {
    try {
      this.deps.tasks.emitTaskCreated(taskId);
    } catch {
      // Notification hooks are best-effort and must never turn a committed
      // acceptance into an ambiguous client failure.
    }
  }

  private appendSubmitReceipt(
    submission: SubmitTaskResult,
    requestCtx: RequestContext,
  ): void {
    this.deps.operationReceipts.append({
      taskId: submission.task.id,
      runAttemptId: submission.runAttempt.id,
      principalId: submission.principalId,
      action: "task.submit",
      decision: "info",
      correlationId: submission.correlation.requestId,
      detail: stampDetailWithCorrelation(
        { source: requestCtx.transport },
        chainFromIds({
          requestId: submission.correlation.requestId,
          taskId: submission.correlation.taskId,
          runAttemptId: submission.correlation.runAttemptId,
        }),
      ),
    });
  }

  private correlation(
    requestId: string,
    taskId: string,
    runAttemptId: string,
  ): CorrelationChain {
    return withRunAttempt(
      withTask(newRequestCorrelation(requestId), taskId),
      runAttemptId,
    );
  }

  private readTaskResult(value: unknown): Task {
    if (!value || typeof value !== "object" || typeof (value as Task).id !== "string") {
      throw new Error("tasks.create receipt has an invalid result");
    }
    return value as Task;
  }
}
