/**
 * Conversation settings reused when draining a queued follow-up.
 * Reads the parent (or latest conversation) task — never hardcoded defaults.
 */
import type {
  ApprovalMode,
  CreateTaskInput,
  EffortLevel,
  ConversationOutboxItem,
} from "@grokdesk/shared";
import type { Db } from "../db.js";

export type FollowUpRunSettings = {
  model: string;
  effort: EffortLevel;
  approvalMode: ApprovalMode;
  workspaceRoots: string[];
  skills: string[];
  mcpServerIds: string[];
  planFirst: boolean;
  rolePack: string | null;
  allowShell: boolean;
  allowNetworkTools: boolean;
  providerSessionId: string | null;
};

type TaskSettingsRow = {
  model: string;
  effort: string;
  policy_json: string;
  skills_json: string | null;
  mcp_json: string | null;
  plan_first: number | null;
  role_pack: string | null;
  provider_session_id: string | null;
};

function parseJsonArray(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function parsePolicy(raw: string): {
  approvalMode: ApprovalMode;
  workspaceRoots: string[];
  allowShell: boolean;
  allowNetworkTools: boolean;
} {
  try {
    const v = JSON.parse(raw || "{}") as Record<string, unknown>;
    const approvalMode =
      v.approvalMode === "strict" ||
      v.approvalMode === "balanced" ||
      v.approvalMode === "autopilot"
        ? v.approvalMode
        : "balanced";
    const workspaceRoots = Array.isArray(v.workspaceRoots)
      ? v.workspaceRoots.filter((x): x is string => typeof x === "string")
      : [];
    return {
      approvalMode,
      workspaceRoots,
      allowShell: v.allowShell !== false,
      allowNetworkTools: v.allowNetworkTools !== false,
    };
  } catch {
    return {
      approvalMode: "balanced",
      workspaceRoots: [],
      allowShell: true,
      allowNetworkTools: true,
    };
  }
}

function rowToSettings(row: TaskSettingsRow): FollowUpRunSettings {
  const policy = parsePolicy(row.policy_json);
  const effort: EffortLevel =
    row.effort === "fast" ||
    row.effort === "normal" ||
    row.effort === "heavy" ||
    row.effort === "max"
      ? row.effort
      : "normal";
  return {
    model: row.model,
    effort,
    approvalMode: policy.approvalMode,
    workspaceRoots: policy.workspaceRoots,
    skills: parseJsonArray(row.skills_json),
    mcpServerIds: parseJsonArray(row.mcp_json),
    planFirst: Boolean(row.plan_first),
    rolePack: row.role_pack,
    allowShell: policy.allowShell,
    allowNetworkTools: policy.allowNetworkTools,
    providerSessionId: row.provider_session_id,
  };
}

const SETTINGS_SELECT = `model, effort, policy_json, skills_json, mcp_json,
      plan_first, role_pack, provider_session_id`;

/**
 * Load the conversation's effective run settings from the parent task,
 * falling back to the latest task in the conversation.
 */
export function loadFollowUpSettings(
  db: Db,
  input: { parentTaskId: string; conversationId: string },
): FollowUpRunSettings | null {
  const parent = db
    .prepare(`SELECT ${SETTINGS_SELECT} FROM tasks WHERE id = ?`)
    .get(input.parentTaskId) as TaskSettingsRow | undefined;
  if (parent) return rowToSettings(parent);

  const latest = db
    .prepare(
      `SELECT ${SETTINGS_SELECT} FROM tasks
       WHERE conversation_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(input.conversationId) as TaskSettingsRow | undefined;
  return latest ? rowToSettings(latest) : null;
}

/**
 * Provider session to resume: this task's attempts, then parent attempts,
 * then the parent/conversation task row.
 */
export function resolvePriorProviderSessionId(
  db: Db,
  input: { taskId: string; parentTaskId?: string | null; conversationId?: string | null },
): string | null {
  const fromAttempts = (taskId: string): string | null => {
    const row = db
      .prepare(
        `SELECT provider_session_id FROM task_run_attempts
         WHERE task_id = ? AND provider_session_id IS NOT NULL
         ORDER BY attempt_number DESC LIMIT 1`,
      )
      .get(taskId) as { provider_session_id: string } | undefined;
    return row?.provider_session_id ?? null;
  };

  const own = fromAttempts(input.taskId);
  if (own) return own;
  if (input.parentTaskId) {
    const parentAttempt = fromAttempts(input.parentTaskId);
    if (parentAttempt) return parentAttempt;
    const parent = db
      .prepare(`SELECT provider_session_id FROM tasks WHERE id = ?`)
      .get(input.parentTaskId) as { provider_session_id: string | null } | undefined;
    if (parent?.provider_session_id) return parent.provider_session_id;
  }
  if (input.conversationId) {
    const turn = db
      .prepare(
        `SELECT provider_session_id FROM turns
         WHERE conversation_id = ? AND provider_session_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(input.conversationId) as
      | { provider_session_id: string }
      | undefined;
    if (turn?.provider_session_id) return turn.provider_session_id;
  }
  return null;
}

export function mergeFollowUpSettings(
  parent: FollowUpRunSettings | null,
  override?: Partial<FollowUpRunSettings> | null,
): FollowUpRunSettings | null {
  if (!parent && !override) return null;
  const base: FollowUpRunSettings = parent ?? {
    model: "grok-4.5",
    effort: "normal",
    approvalMode: "balanced",
    workspaceRoots: [],
    skills: [],
    mcpServerIds: [],
    planFirst: false,
    rolePack: null,
    allowShell: true,
    allowNetworkTools: true,
    providerSessionId: null,
  };
  if (!override) return base;
  return {
    ...base,
    ...(override.model?.trim() ? { model: override.model.trim() } : {}),
    ...(override.effort ? { effort: override.effort } : {}),
    ...(override.approvalMode ? { approvalMode: override.approvalMode } : {}),
    ...(override.planFirst !== undefined ? { planFirst: override.planFirst } : {}),
    ...(override.rolePack !== undefined ? { rolePack: override.rolePack } : {}),
  };
}

export function buildDrainedCreateInput(
  claimed: Pick<
    ConversationOutboxItem,
    "id" | "text" | "attachments" | "parentTaskId" | "revisionOfTaskId"
  >,
  settings: FollowUpRunSettings | null,
): CreateTaskInput & { clientMutationId: string } {
  const input: CreateTaskInput & { clientMutationId: string } = {
    goal: claimed.text,
    parentTaskId: claimed.parentTaskId,
    attachments: claimed.attachments,
    clientMutationId: claimed.id,
    mode: "interactive",
    ...(claimed.revisionOfTaskId
      ? { revisionOfTaskId: claimed.revisionOfTaskId }
      : {}),
  };
  if (!settings) return input;
  input.model = settings.model;
  input.effort = settings.effort;
  input.effortExplicit = true;
  input.approvalMode = settings.approvalMode;
  input.allowShell = settings.allowShell;
  input.allowNetworkTools = settings.allowNetworkTools;
  input.skills = settings.skills;
  input.mcpServerIds = settings.mcpServerIds;
  input.planFirst = settings.planFirst;
  input.rolePack = settings.rolePack;
  if (settings.workspaceRoots.length > 0) {
    input.workspaceRoots = settings.workspaceRoots;
  }
  return input;
}
