export const TASK_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "waiting_user",
  "blocked",
  "done",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

/** Non-terminal statuses: the task is still "live" (poll, stop, busy indicators). */
export const ACTIVE_TASK_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "waiting_user",
  "blocked",
] as const satisfies readonly TaskStatus[];

export type ActiveTaskStatus = (typeof ACTIVE_TASK_STATUSES)[number];

const ACTIVE_TASK_STATUS_SET: ReadonlySet<string> = new Set(ACTIVE_TASK_STATUSES);

export function isActiveTaskStatus(
  status: string | null | undefined,
): status is ActiveTaskStatus {
  return status != null && ACTIVE_TASK_STATUS_SET.has(status);
}

export const TASK_MODES = ["interactive", "scheduled", "proactive"] as const;
export type TaskMode = (typeof TASK_MODES)[number];

export const APPROVAL_MODES = ["strict", "balanced", "autopilot"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const EFFORT_LEVELS = ["fast", "normal", "heavy", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export type TrayStatus =
  | "idle"
  | "working"
  | "needs_you"
  | "paused"
  | "reauth"
  | "error";

export interface PolicySnapshot {
  approvalMode: ApprovalMode;
  workspaceRoots: string[];
  allowNetworkTools: boolean;
  allowShell: boolean;
}

export interface Task {
  id: string;
  goal: string;
  /** Short, editable display name (Grok-generated). Null → fall back to goal. */
  title: string | null;
  mode: TaskMode;
  status: TaskStatus;
  model: string;
  effort: EffortLevel;
  /** Draft-a-plan-first: session starts in plan mode; run gated on approval. */
  planFirst?: boolean;
  policySnapshot: PolicySnapshot;
  projectId: string | null;
  parentTaskId: string | null;
  revisionOfTaskId: string | null;
  /** Conversation ledger id when bound; null for legacy unbound rows. */
  conversationId?: string | null;
  /** Reload-safe accepted input metadata. Null/missing means a legacy unknown. */
  attachments?: TaskAttachment[] | null;
  scheduleRuleId: string | null;
  rolePack: string | null;
  skills: string[];
  mcpServerIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** UI locale for reply language (LANG-1). Pass-through; not a DB column. */
  locale?: string;
  /** Compact composer text before slash expansion (CMD-4). */
  goalSource?: string;
}

export const TASK_EVENT_KINDS = [
  "message",
  "step",
  "tool_request",
  "tool_result",
  "approval_required",
  "approval_resolved",
  "artifact_created",
  "status_change",
  "error",
  "plan_update",
  "citations",
  "worker_started",
  "worker_activity",
  "worker_message",
  "worker_completed",
  "worker_failed",
] as const;

export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

export interface TaskEvent {
  id: string;
  taskId: string;
  seq: number;
  kind: TaskEventKind;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Artifact {
  id: string;
  taskId: string;
  title: string;
  kind: "file" | "report" | "media" | "card";
  path: string | null;
  mimeType: string | null;
  createdAt: string;
}

export interface ScheduleRule {
  id: string;
  name: string;
  goalTemplate: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  quietHoursRespect: boolean;
  approvalMode: ApprovalMode;
  model: string;
  effort: EffortLevel;
  workspaceRoots: string[];
  rolePack: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MemoryKind =
  | "profile"
  | "project"
  | "brand"
  | "preference"
  | "episodic"
  | "now"
  | "standing";

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  title: string;
  content: string;
  projectId: string | null;
  provenance: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InboxKind =
  | "approval"
  | "clarification"
  | "unfinished"
  | "schedule_done"
  | "suggestion"
  | "reauth"
  | "engine"
  | "recap";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  body: string;
  taskId: string | null;
  read: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  taskId: string | null;
  action: string;
  detail: Record<string, unknown>;
  decision: "allow" | "deny" | "approve" | "reject" | "info";
  createdAt: string;
}

export interface AuthState {
  signedIn: boolean;
  accountLabel: string | null;
  /** Display name from the SuperGrok profile; UI prefers this over the email. */
  accountName?: string | null;
  needsReauth: boolean;
  engineStatus: "unknown" | "missing" | "ready" | "needs_auth" | "signed_out";
}

/** SuperGrok credit/usage snapshot (Build /usage rails). Not Desk license. */
export interface UsageSnapshot {
  fetchedAt: string;
  creditUsagePercent: number | null;
  includedUsed: number | null;
  totalUsed: number | null;
  monthlyLimit: number | null;
  onDemandEnabled: boolean | null;
  onDemandUsed: number | null;
  onDemandCap: number | null;
  prepaidBalance: number | null;
  subscriptionTier: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  /** True when UI should surface a soft warning (e.g. ≥70%). */
  warnLevel: "none" | "soft" | "hard";
  rawAvailable: boolean;
}

export interface PrivacyState {
  /** Whether xAI may retain coding session data (Build /privacy). */
  codingDataSharing: boolean | null;
  summary: string;
  fetchedAt: string;
  /** True when value is stored only in Desk (no remote privacy API). */
  localOnly?: boolean;
}

/** User-selected file attached to a chat task (images staged; files by path). */
export interface TaskAttachment {
  id: string;
  name: string;
  sourcePath: string;
  kind: "image" | "file" | "audio";
  stagedPath?: string;
  mime?: string;
  sizeBytes?: number;
  /** Digest of the exact bytes accepted for crash-safe materialization. */
  contentSha256?: string;
}

export interface CreateTaskInput {
  goal: string;
  mode?: TaskMode;
  model?: string;
  effort?: EffortLevel;
  /**
   * True when the client UI/user actually chose effort (not schema default).
   * When omitted/false, gateway may apply role-pack defaultEffort.
   */
  effortExplicit?: boolean;
  /** Draft a plan first (ACP plan mode). */
  planFirst?: boolean;
  /** Empty or omitted → gateway creates a temp chat workspace. */
  workspaceRoots?: string[];
  approvalMode?: ApprovalMode;
  /** When omitted, derived conservatively from approvalMode (strict → false). */
  allowShell?: boolean;
  /** When omitted, derived conservatively from approvalMode (strict → false). */
  allowNetworkTools?: boolean;
  rolePack?: string | null;
  skills?: string[];
  mcpServerIds?: string[];
  projectId?: string | null;
  scheduleRuleId?: string | null;
  parentTaskId?: string | null;
  revisionOfTaskId?: string;
  /** Optional files/images/audio for this turn (staged on create). */
  attachments?: TaskAttachment[];
  /** Client-supplied idempotency key for remote/local retries. */
  clientMutationId?: string;
  /** UI locale for reply language (LANG-1). */
  locale?: string;
  /** Compact composer text before slash expansion (CMD-4). */
  goalSource?: string;
}
