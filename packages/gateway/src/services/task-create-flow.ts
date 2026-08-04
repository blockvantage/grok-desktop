/**
 * Orchestrate tasks.create: stage attachments, apply role pack, submit,
 * receipt, conversation bind, kick run + optional auto-title (Phase 6).
 */
import type { CreateTaskInput, Task, TaskAttachment } from "@grokdesk/shared";
import type { CorrelationChain } from "@grokdesk/shared";
import type { RequestContext } from "./request-context.js";
import {
  cleanupUnacceptedManagedWorkspace,
  stageAttachmentsForCreate,
} from "./attachment-create.js";
import {
  applyRolePackToCreateParams,
  type RolePackLike,
} from "./role-pack-apply.js";
import type { SubmitTaskResult } from "./task-submission.js";
import {
  tryBindTaskConversation,
  type ConversationBindDeps,
} from "./task-conversation-bind.js";
import {
  chainFromIds,
  stampDetailWithCorrelation,
} from "./correlation-stamp.js";
import type {
  AcceptedTaskCreate,
  TaskCreateMutationKey,
} from "./task-create-acceptance.js";

export type TaskCreateParams = CreateTaskInput & {
  attachments?: TaskAttachment[];
  effort?: CreateTaskInput["effort"];
};

export interface TaskCreateFlowDeps {
  dataDir: string;
  resolveWorkspaceRoots(params: TaskCreateParams): string[];
  lookupRolePack(id: string): RolePackLike | null | undefined;
  upsertStandingMemory(item: {
    id?: string;
    kind: "standing";
    title: string;
    content: string;
    provenance: string;
  }): void;
  reconcileStandingMemory?(task: Task): void;
  finalizeAttachments?(task: Task): boolean | void;
  submit(
    input: CreateTaskInput,
    ctx: RequestContext,
  ): SubmitTaskResult;
  /** Production acceptance path; commits task kernel + mutation receipt. */
  acceptTaskCreate?(
    input: CreateTaskInput,
    ctx: RequestContext,
    mutation?: TaskCreateMutationKey,
  ): AcceptedTaskCreate;
  appendSubmitReceipt(input: {
    taskId: string;
    runAttemptId: string;
    principalId: string | null;
    correlationId: string;
    detail: Record<string, unknown>;
  }): void;
  conversation: ConversationBindDeps;
  runWithMemory(
    taskId: string,
    correlation: { requestId?: string; runAttemptId?: string },
  ): void | Promise<void>;
  autoTitle(taskId: string, goal: string, model: string): void | Promise<void>;
}

export interface TaskCreateFlowResult {
  task: Task;
  correlation: CorrelationChain;
  runAttemptId: string;
}

/**
 * Full tasks.create path after IPC parse. Throws on attachment stage failure.
 */
export function executeTaskCreate(
  paramsIn: TaskCreateParams,
  requestCtx: RequestContext,
  deps: TaskCreateFlowDeps,
  opts?: {
    effortWasExplicit?: boolean;
    mutation?: TaskCreateMutationKey;
  },
): TaskCreateFlowResult {
  const params = { ...paramsIn };
  const titleSource = params.goal;
  params.workspaceRoots = deps.resolveWorkspaceRoots(params);
  const primary = params.workspaceRoots[0];

  const staged = stageAttachmentsForCreate({
    primaryRoot: primary,
    attachments: params.attachments ?? [],
    parentTaskId: params.parentTaskId,
    dataDir: deps.dataDir,
  });
  if (!staged.ok) throw staged.error;

  // Persist only staged path metadata on the accepted task. File bytes remain
  // on disk and the cumulative engine manifest keeps its existing behavior.
  params.attachments = staged.attachments ?? [];

  let packResult: ReturnType<typeof applyRolePackToCreateParams>;
  let accepted: AcceptedTaskCreate;
  try {
    packResult = applyRolePackToCreateParams(
      params,
      (id) => deps.lookupRolePack(id),
      { effortWasExplicit: opts?.effortWasExplicit ?? false },
    );
    if (deps.acceptTaskCreate) {
      accepted = deps.acceptTaskCreate(params, requestCtx, opts?.mutation);
    } else {
      // Compatibility seam for focused unit tests and embedders. Gateway always
      // provides acceptTaskCreate so production cannot split this durable unit.
      const { task, runAttempt, correlation } = deps.submit(params, requestCtx);
      deps.appendSubmitReceipt({
        taskId: task.id,
        runAttemptId: runAttempt.id,
        principalId:
          requestCtx.principalDeviceId ??
          (requestCtx.transport === "desktop" ? "desktop" : null),
        correlationId: correlation.requestId,
        detail: stampDetailWithCorrelation(
          { source: requestCtx.transport },
          chainFromIds({
            requestId: correlation.requestId,
            taskId: correlation.taskId,
            runAttemptId: correlation.runAttemptId,
          }),
        ),
      });
      accepted = {
        kind: "fresh",
        resultTask: task,
        acceptedTask: task,
        runAttempt,
        correlation,
      };
    }
  } catch (error) {
    cleanupUnacceptedManagedWorkspace({
      primaryRoot: primary,
      parentTaskId: params.parentTaskId,
      dataDir: deps.dataDir,
    });
    throw error;
  }

  cleanupUnacceptedManagedWorkspace({
    primaryRoot: primary,
    parentTaskId: params.parentTaskId,
    dataDir: deps.dataDir,
    acceptedPrimaryRoot:
      accepted.acceptedTask.policySnapshot.workspaceRoots[0],
  });

  // Every non-durable effect begins after the acceptance method returned and
  // therefore after its synchronous SQLite commit.
  if (
    accepted.kind === "fresh" &&
    packResult.standingMemory &&
    !deps.reconcileStandingMemory
  ) {
    deps.upsertStandingMemory(packResult.standingMemory);
  }
  resumeAcceptedTaskCreate(accepted, deps, titleSource);

  return {
    task: accepted.resultTask,
    correlation: accepted.correlation,
    runAttemptId: accepted.runAttempt.id,
  };
}

/** Idempotently finish post-commit ledgers and kick a still-queued task. */
export function resumeAcceptedTaskCreate(
  accepted: AcceptedTaskCreate,
  deps: Pick<
    TaskCreateFlowDeps,
    "conversation" | "runWithMemory" | "autoTitle"
  > &
    Pick<
      TaskCreateFlowDeps,
      "reconcileStandingMemory" | "finalizeAttachments"
    >,
  titleSource = accepted.acceptedTask.goal,
): void {
  const task = accepted.acceptedTask;
  deps.reconcileStandingMemory?.(task);
  const conversation = tryBindTaskConversation(task, deps.conversation);
  if (!conversation) return;

  if (task.status === "queued") {
    try {
      if (deps.finalizeAttachments?.(task) === false) return;
    } catch {
      return;
    }
    void deps.runWithMemory(task.id, {
      requestId: accepted.correlation.requestId,
      runAttemptId: accepted.runAttempt.id,
    });
  }

  if (!task.parentTaskId && !task.title) {
    void deps.autoTitle(task.id, titleSource, task.model);
  }
}
