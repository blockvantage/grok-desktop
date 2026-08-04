/**
 * tasks.create IPC wrapper around executeTaskCreate (Phase 6 extract).
 */

import type { RequestContext } from "./request-context.js";
import {
  executeTaskCreate,
  type TaskCreateFlowDeps,
  type TaskCreateParams,
} from "./task-create-flow.js";
import type { TaskCreateMutationKey } from "./task-create-acceptance.js";

/**
 * Dispatch tasks.create using TaskCreateFlowDeps already bound by Gateway.
 */
export function dispatchTasksCreate(
  params: TaskCreateParams & Record<string, unknown>,
  requestCtx: RequestContext,
  deps: TaskCreateFlowDeps,
  mutation?: TaskCreateMutationKey,
): unknown {
  const { task } = executeTaskCreate(
    params,
    requestCtx,
    deps,
    {
      // Prefer client-reported explicitness. Schema defaults always set
      // params.effort, so !!params.effort is always true and blocked pack
      // defaultEffort. Omitted/false → pack may fill; true → keep user choice.
      effortWasExplicit: params.effortExplicit === true,
      mutation,
    },
  );
  return task;
}

/**
 * Build TaskCreateFlowDeps from gateway service methods.
 */
export function buildTaskCreateFlowDeps(input: {
  dataDir: string;
  resolveWorkspaceRoots: TaskCreateFlowDeps["resolveWorkspaceRoots"];
  lookupRolePack: TaskCreateFlowDeps["lookupRolePack"];
  upsertStandingMemory: TaskCreateFlowDeps["upsertStandingMemory"];
  reconcileStandingMemory?: TaskCreateFlowDeps["reconcileStandingMemory"];
  finalizeAttachments?: TaskCreateFlowDeps["finalizeAttachments"];
  submit: TaskCreateFlowDeps["submit"];
  acceptTaskCreate?: TaskCreateFlowDeps["acceptTaskCreate"];
  appendSubmitReceipt: TaskCreateFlowDeps["appendSubmitReceipt"];
  conversation: TaskCreateFlowDeps["conversation"];
  runWithMemory: TaskCreateFlowDeps["runWithMemory"];
  autoTitle: TaskCreateFlowDeps["autoTitle"];
}): TaskCreateFlowDeps {
  return input;
}
