/**
 * Pure helpers for optimistic task create UI (Phase 6 extract from App.tsx).
 * Keeps goal/validation/policy defaults out of the React component body.
 */
import type {
  ApprovalMode,
  EffortLevel,
  Task,
  TaskAttachment,
} from "@grokdesk/shared";
import { getActiveLocale, t } from "@/i18n/active";
import { expandSlashGoal } from "./composer-input";
import {
  expandComposerGoal,
  type ComposerIntentId,
} from "./composer-intents";

export type CreateTaskFormState = {
  goal: string;
  root: string;
  model: string;
  effort: EffortLevel;
  /**
   * True when the user chose effort (not left at default "normal").
   * Omitted → treated as unset for gateway role-pack defaultEffort.
   */
  effortExplicit?: boolean;
  approvalMode: ApprovalMode;
  rolePack: string | null;
  attachments?: TaskAttachment[];
  /** Draft a plan first (ACP plan mode). */
  planFirst?: boolean;
  /**
   * Phase 3 structured intent mode (chip). Expanded at create time; not
   * dumped into the textarea. Takes precedence over slash expansion.
   */
  intentId?: ComposerIntentId | string | null;
};

/** Build RPC params for tasks.create from composer state. */
export function buildCreateTaskParams(
  form: CreateTaskFormState,
  clientMutationId?: string,
): {
  goal: string;
  workspaceRoots: string[];
  model: string;
  effort: EffortLevel;
  effortExplicit?: boolean;
  approvalMode: ApprovalMode;
  rolePack: string | null;
  planFirst?: boolean;
  attachments?: TaskAttachment[];
  clientMutationId?: string;
  locale?: string;
  goalSource?: string;
  /** When intent wants schedule surface instead of tasks.create. */
  sendAction?: "create_task" | "open_schedule";
} {
  const raw = form.goal.trim();
  const expanded = expandComposerGoal(raw, {
    intentId: form.intentId,
    translate: t,
  });
  const workspaceRoots = form.root.trim() ? [form.root.trim()] : [];
  const hasSource =
    expanded.command != null || expanded.intent != null;
  return {
    goal: expanded.goal,
    workspaceRoots,
    model: form.model,
    effort: form.effort,
    // Only send when true so legacy paths (omit) stay pack-overridable.
    ...(form.effortExplicit === true ? { effortExplicit: true as const } : {}),
    approvalMode: form.approvalMode,
    rolePack: form.rolePack,
    locale: getActiveLocale(),
    ...(hasSource ? { goalSource: expanded.source } : {}),
    ...(form.planFirst ? { planFirst: true } : {}),
    ...(clientMutationId ? { clientMutationId } : {}),
    ...(form.attachments?.length ? { attachments: form.attachments } : {}),
    ...(expanded.sendAction !== "create_task"
      ? { sendAction: expanded.sendAction }
      : {}),
  };
}

/**
 * Placeholder Task shown immediately on Run before the gateway returns.
 * Conservative: shell denied until the real task row (with policy) arrives.
 */
export function buildOptimisticTask(
  form: CreateTaskFormState & { id: string; nowIso?: string },
): Task {
  const params = buildCreateTaskParams(form);
  const nowIso = form.nowIso ?? new Date().toISOString();
  return {
    id: form.id,
    goal: params.goal,
    title: null,
    mode: "interactive",
    status: "queued",
    model: params.model,
    effort: params.effort,
    planFirst: params.planFirst === true,
    policySnapshot: {
      approvalMode: params.approvalMode,
      workspaceRoots: params.workspaceRoots,
      allowNetworkTools: true,
      allowShell: false,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    attachments: params.attachments?.map((attachment) => ({ ...attachment })) ?? [],
    scheduleRuleId: null,
    rolePack: params.rolePack,
    skills: [],
    mcpServerIds: [],
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: null,
    ...(params.goalSource !== undefined
      ? { goalSource: params.goalSource }
      : {}),
    ...(params.locale !== undefined ? { locale: params.locale } : {}),
  };
}

/** Reconcile optimistic placeholders with the real gateway task. */
export function mergeCreatedTask(
  prev: Task[],
  created: Task,
): Task[] {
  return [
    created,
    ...prev.filter(
      (t) => !t.id.startsWith("optimistic-") && t.id !== created.id,
    ),
  ];
}

/** Roll back optimistic placeholders after create failure. */
export function dropOptimisticTasks(prev: Task[]): Task[] {
  return prev.filter((t) => !t.id.startsWith("optimistic-"));
}

export type FollowUpBaseTask = Pick<
  Task,
  "id" | "model" | "effort" | "rolePack" | "policySnapshot"
>;

/**
 * Resolve workspace roots for a follow-up: prefer parent chat roots, else composer root.
 */
export function resolveFollowUpWorkspaceRoots(
  base: FollowUpBaseTask,
  composerRoot: string,
): string[] {
  if (base.policySnapshot.workspaceRoots?.length) {
    return [...base.policySnapshot.workspaceRoots];
  }
  const r = composerRoot.trim();
  return r ? [r] : [];
}

/** Build tasks.create params for a follow-up turn (parentTaskId bound). */
export function buildFollowUpTaskParams(input: {
  goalText: string;
  base: FollowUpBaseTask;
  composerRoot: string;
  fallbackModel: string;
  fallbackEffort: EffortLevel;
  fallbackApprovalMode: ApprovalMode;
  attachments?: TaskAttachment[];
  clientMutationId?: string;
  revisionOfTaskId?: string;
}): {
  goal: string;
  workspaceRoots: string[];
  model: string;
  effort: EffortLevel;
  /** Parent effort is already resolved — do not re-apply pack default. */
  effortExplicit: true;
  approvalMode: ApprovalMode;
  parentTaskId: string;
  rolePack: string | null;
  attachments: TaskAttachment[];
  clientMutationId?: string;
  revisionOfTaskId?: string;
  locale?: string;
  goalSource?: string;
} {
  const raw = input.goalText.trim();
  const expanded = expandSlashGoal(raw, t);
  return {
    goal: expanded.goal,
    workspaceRoots: resolveFollowUpWorkspaceRoots(
      input.base,
      input.composerRoot,
    ),
    model: input.base.model ?? input.fallbackModel,
    // Prefer the live composer effort so mid-conversation changes apply.
    // Still mark explicit so role-pack defaultEffort does not clobber it.
    effort: input.fallbackEffort ?? input.base.effort,
    effortExplicit: true,
    approvalMode:
      input.base.policySnapshot.approvalMode ?? input.fallbackApprovalMode,
    parentTaskId: input.base.id,
    rolePack: input.base.rolePack ?? null,
    attachments: input.attachments ?? [],
    locale: getActiveLocale(),
    ...(expanded.command != null ? { goalSource: expanded.source } : {}),
    ...(input.clientMutationId
      ? { clientMutationId: input.clientMutationId }
      : {}),
    ...(input.revisionOfTaskId
      ? { revisionOfTaskId: input.revisionOfTaskId }
      : {}),
  };
}

/** True when the workspace task is a real gateway task (not optimistic placeholder). */
export function canFollowUpOnTask(task: Task | null | undefined): boolean {
  if (!task) return false;
  return !task.id.startsWith("optimistic-");
}
