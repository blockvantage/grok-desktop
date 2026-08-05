import type {
  Artifact,
  Task,
  TaskAttachment,
  TaskEvent,
  TaskStatus,
} from "@grokdesk/shared";
import type { DurableQueuedMessage } from "./message-queue-store";
import { coalesceBrowserToolActivity } from "./browser-activity-from-events";
import { foldRecoveredWorkEntries } from "./work-graph";

export type RunState = TaskStatus;

export type PrimaryRunView = {
  id: string;
  state: RunState;
  startedAt: string;
  completedAt: string | null;
};

export type WorkerView = {
  id: string;
  label: string | null;
  objective: string | null;
  parentWorkerId: string | null;
  status: "running" | "done" | "failed" | "cancelled";
  currentActivity: string | null;
  result: string | null;
};

export type AnswerView = {
  eventId: string;
  text: string;
  createdAt: string;
};

export type WorkEntry = {
  id: string;
  timestamp: string;
  kind: string;
  summary: string;
  detail: string | null;
  workerId: string | null;
  diagnostic: boolean;
  payload: Record<string, unknown>;
};

export type ApprovalView = {
  approvalId: string;
  eventId: string;
  summary: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type ErrorView = {
  eventId: string;
  message: string;
  createdAt: string;
};

export type TurnPlan = {
  content: string;
  status: "drafting" | "awaiting_approval" | "approved";
};

export type CitationItem = {
  url: string;
  title?: string;
  snippet?: string;
  source?: "web" | "x" | "other";
};

export type ConversationTurn = {
  id: string;
  taskId: string;
  /**
   * Bubble text: compact slash source when present, else the full goal.
   * Edit/rewind re-open this compact form.
   */
  userMessage: string;
  /**
   * Expanded engine prompt when the bubble shows a compact goalSource.
   * Undefined for plain goals and legacy turns.
   */
  fullPrompt?: string;
  attachments: TaskAttachment[];
  /** False for legacy rows whose accepted attachment input was never stored. */
  attachmentsKnown: boolean;
  revisionOfTurnId: string | null;
  superseded: boolean;
  state: RunState;
  primaryRun: PrimaryRunView;
  workers: Record<string, WorkerView>;
  answer: AnswerView | null;
  /** Short operational narration shown only while the turn is live. */
  liveSummary: string | null;
  work: WorkEntry[];
  artifacts: Artifact[];
  approval: ApprovalView | null;
  error: ErrorView | null;
  plan: TurnPlan | null;
  citations: CitationItem[];
};

export type ConversationSnapshot = {
  conversationId: string;
  title: string | null;
  turns: ConversationTurn[];
  queued: DurableQueuedMessage[];
  activeTurnId: string | null;
  needsUserAction: boolean;
};

export type ConversationProjectionInput = {
  conversationId: string;
  title: string | null;
  /** Already restricted to this logical conversation by the caller. */
  tasks: Task[];
  /** Storage buckets are authoritative; never move an event using event.taskId. */
  eventsByTask: Record<string, TaskEvent[] | undefined>;
  artifactsByTask?: Record<string, Artifact[] | undefined>;
  /** Accepted input metadata retained by the caller for edit-and-rerun. */
  attachmentsByTask?: Record<
    string,
    TaskAttachment[] | null | undefined
  >;
  queued?: DurableQueuedMessage[];
};

const TERMINAL_RUN_STATE_RANK: Partial<Record<RunState, number>> = {
  done: 1,
  cancelled: 2,
  failed: 3,
};

const PROVIDER_NOISE_PATTERNS = [
  /^Grok Build session$/i,
  /^Session ready/i,
  /^Still working on tools in the background/i,
  /^Grok CLI .* probing capabilities/i,
  /^Isolated Grok profile/i,
];

export function isProviderNoise(text: string): boolean {
  const normalized = text.trim();
  return PROVIDER_NOISE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isOperationalNarration(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || normalized.length > 280) return false;
  return /^(?:let me\b|i(?:'|’)?ll\b|i will\b|i(?:'|’)?m (?:going to|checking|looking|opening|reading|researching|running|working)\b|i am (?:going to|checking|looking|opening|reading|researching|running|working)\b|(?:checking|looking|opening|reading|researching|running|working)\b)/i.test(
    normalized,
  );
}

export function isSafeAssistantDisplayText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || normalized.length > 96_000) return false;
  if (/^data:[^;,]+;base64,/i.test(normalized)) return false;
  if (
    normalized.length >= 4_096 &&
    !/\s/.test(normalized) &&
    /^[A-Za-z0-9+/]+=*$/.test(normalized)
  ) {
    return false;
  }
  if (normalized.startsWith("{") && normalized.endsWith("}")) {
    try {
      const parsed = JSON.parse(normalized) as Record<string, unknown>;
      const type = typeof parsed.type === "string" ? parsed.type.toLowerCase() : "";
      if (
        type === "tool_call_update" ||
        type === "tool_call" ||
        type === "tool_result" ||
        type === "thought" ||
        (Array.isArray(parsed.content) && "toolCallId" in parsed)
      ) {
        return false;
      }
    } catch {
      // A prose response may legitimately contain braces.
    }
  }
  return true;
}

/**
 * Nonterminal observations follow chronological order. Once a terminal state
 * is observed it cannot regress, and terminal conflicts resolve with stable,
 * commutative precedence: failed > cancelled > done.
 */
export function mergeRunState(
  previous: RunState,
  incoming: RunState,
): RunState {
  const previousTerminal = TERMINAL_RUN_STATE_RANK[previous] ?? 0;
  const incomingTerminal = TERMINAL_RUN_STATE_RANK[incoming] ?? 0;
  if (previousTerminal || incomingTerminal) {
    return incomingTerminal > previousTerminal ? incoming : previous;
  }
  return incoming;
}

function nonBlank(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function workerIdFrom(event: TaskEvent): string | null {
  return nonBlank(event.payload.workerId);
}

function terminalWorkerStatus(
  kind: TaskEvent["kind"],
): WorkerView["status"] | null {
  if (kind === "worker_completed") return "done";
  if (kind === "worker_failed") return "failed";
  return null;
}

function mergeWorkerStatus(
  previous: WorkerView["status"],
  incoming: WorkerView["status"],
): WorkerView["status"] {
  const rank: Record<WorkerView["status"], number> = {
    running: 0,
    done: 1,
    cancelled: 2,
    failed: 3,
  };
  return rank[incoming] > rank[previous] ? incoming : previous;
}

/** Merge one truthful worker lifecycle event. Missing IDs create no worker. */
export function mergeWorker(
  previous: WorkerView | undefined,
  event: TaskEvent,
): WorkerView | undefined {
  const workerId = workerIdFrom(event);
  if (!workerId || !event.kind.startsWith("worker_")) return previous;

  const incomingTerminal = terminalWorkerStatus(event.kind);
  const started = event.kind === "worker_started";
  const activity =
    event.kind === "worker_activity" || event.kind === "worker_message";
  if (!started && !activity && !incomingTerminal) return previous;

  const incomingParent = nonBlank(event.payload.parentWorkerId);
  const incomingLabel = nonBlank(event.payload.label);
  const incomingObjective = nonBlank(event.payload.objective);
  const summary =
    nonBlank(event.payload.summary) ?? nonBlank(event.payload.text);
  const base: WorkerView = previous ?? {
    id: workerId,
    // A lifecycle observed after its start may use the explicit ID as display.
    label: started ? incomingLabel : workerId,
    objective: null,
    parentWorkerId: incomingParent,
    status: "running",
    currentActivity: null,
    result: null,
  };

  if (started) {
    return {
      ...base,
      label: incomingLabel ?? base.label,
      objective: incomingObjective ?? base.objective,
      parentWorkerId: base.parentWorkerId ?? incomingParent,
    };
  }

  if (incomingTerminal) {
    const status = mergeWorkerStatus(base.status, incomingTerminal);
    const incomingWon = status !== base.status;
    return {
      ...base,
      parentWorkerId: base.parentWorkerId ?? incomingParent,
      status,
      currentActivity: null,
      result: incomingWon || !base.result ? summary ?? base.result : base.result,
    };
  }

  if (base.status !== "running") return base;
  return {
    ...base,
    parentWorkerId: base.parentWorkerId ?? incomingParent,
    currentActivity: summary ?? base.currentActivity,
  };
}

function compareStable(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string },
): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function compareEvents(a: TaskEvent, b: TaskEvent): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.seq - b.seq ||
    a.id.localeCompare(b.id)
  );
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${stableSerialize(entry)}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

function compareEventCopies(a: TaskEvent, b: TaskEvent): number {
  const aSemantic = stableSerialize({
    kind: a.kind,
    taskId: a.taskId,
    payload: a.payload,
  });
  const bSemantic = stableSerialize({
    kind: b.kind,
    taskId: b.taskId,
    payload: b.payload,
  });
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.seq - b.seq ||
    aSemantic.length - bSemantic.length ||
    aSemantic.localeCompare(bSemantic)
  );
}

function canonicalEvents(sourceEvents: TaskEvent[]): TaskEvent[] {
  const byId = new Map<string, TaskEvent>();
  for (const event of sourceEvents) {
    const previous = byId.get(event.id);
    if (!previous || compareEventCopies(previous, event) < 0) {
      byId.set(event.id, event);
    }
  }
  return [...byId.values()].sort(compareEvents);
}

type RunStateObservation = {
  state: RunState;
  timestamp: string;
  seq: number;
  id: string;
};

function compareRunStateObservations(
  a: RunStateObservation,
  b: RunStateObservation,
): number {
  return (
    a.timestamp.localeCompare(b.timestamp) ||
    a.seq - b.seq ||
    a.id.localeCompare(b.id)
  );
}

function runStateFrom(value: unknown): RunState | null {
  if (typeof value !== "string") return null;
  switch (value) {
    case "queued":
    case "running":
    case "waiting_user":
    case "waiting_approval":
    case "blocked":
    case "done":
    case "failed":
    case "cancelled":
      return value;
    default:
      return null;
  }
}

function eventSummary(event: TaskEvent): string {
  const payload = event.payload;
  return (
    nonBlank(payload.text) ??
    nonBlank(payload.title) ??
    nonBlank(payload.summary) ??
    nonBlank(payload.message) ??
    nonBlank(payload.reason) ??
    nonBlank(payload.prompt) ??
    nonBlank(payload.output) ??
    nonBlank(payload.status) ??
    nonBlank(payload.tool) ??
    event.kind.replace(/_/g, " ")
  );
}

function workEntryFrom(event: TaskEvent): WorkEntry {
  const summary = eventSummary(event);
  const channel = nonBlank(event.payload.channel);
  return {
    id: event.id,
    timestamp: event.createdAt,
    kind: event.kind,
    summary,
    detail: stableSerialize(event.payload),
    workerId: workerIdFrom(event),
    diagnostic:
      channel === "thought" ||
      isProviderNoise(summary) ||
      event.kind === "worker_failed" ||
      (event.kind === "error" && workerIdFrom(event) !== null),
    payload: { ...event.payload },
  };
}

function artifactFromEvent(event: TaskEvent, taskId: string): Artifact | null {
  if (event.kind !== "artifact_created") return null;
  const id = nonBlank(event.payload.id);
  if (!id) return null;
  const kind = nonBlank(event.payload.kind);
  if (
    kind !== "file" &&
    kind !== "report" &&
    kind !== "media" &&
    kind !== "card"
  ) {
    return null;
  }
  return {
    id,
    taskId,
    title: nonBlank(event.payload.title) ?? id,
    kind,
    path: nonBlank(event.payload.path),
    mimeType: nonBlank(event.payload.mimeType),
    createdAt: event.createdAt,
  };
}

function projectTurn(
  task: Task,
  sourceEvents: TaskEvent[],
  sourceArtifacts: Artifact[],
  sourceAttachments: TaskAttachment[],
  attachmentsKnown: boolean,
): ConversationTurn {
  const events = canonicalEvents(sourceEvents);
  const statusObservations: RunStateObservation[] = [
    {
      state: task.status,
      timestamp: task.updatedAt,
      // At an identical timestamp, the materialized task row is authoritative.
      seq: Number.MAX_SAFE_INTEGER,
      id: `task:${task.id}`,
    },
  ];
  const workers: Record<string, WorkerView> = {};
  let answer: AnswerView | null = null;
  let liveSummary: string | null = null;
  const pendingApprovals = new Map<string, ApprovalView>();
  let primaryError: ErrorView | null = null;
  const eventArtifacts: Artifact[] = [];
  let plan: TurnPlan | null = null;
  let citations: CitationItem[] = [];

  for (const event of events) {
    if (event.kind === "status_change") {
      const incoming =
        runStateFrom(event.payload.status) ?? runStateFrom(event.payload.to);
      if (incoming) {
        statusObservations.push({
          state: incoming,
          timestamp: event.createdAt,
          seq: event.seq,
          id: event.id,
        });
      }
    }

    const workerId = workerIdFrom(event);
    if (workerId) {
      const merged = mergeWorker(workers[workerId], event);
      if (merged) workers[workerId] = merged;
    }

    if (event.kind === "message") {
      const role = nonBlank(event.payload.role);
      const channel = nonBlank(event.payload.channel);
      const text = nonBlank(event.payload.text);
      if (
        role === "assistant" &&
        channel === "text" &&
        text &&
        !isProviderNoise(text) &&
        isSafeAssistantDisplayText(text)
      ) {
        if (
          event.payload.terminal !== true &&
          isOperationalNarration(text)
        ) {
          liveSummary = text;
        } else {
          answer = { eventId: event.id, text, createdAt: event.createdAt };
        }
      }
    }

    if (event.kind === "approval_required") {
      const approvalId = nonBlank(event.payload.approvalId);
      if (approvalId) {
        pendingApprovals.set(approvalId, {
          approvalId,
          eventId: event.id,
          summary: eventSummary(event),
          createdAt: event.createdAt,
          payload: { ...event.payload },
        });
      }
    } else if (event.kind === "approval_resolved") {
      const approvalId = nonBlank(event.payload.approvalId);
      if (approvalId) pendingApprovals.delete(approvalId);
      const decision = nonBlank(event.payload.decision);
      // tsc 5.9 CFA narrows `plan` to null inside this else-if arm even though
      // plan_update assigns it in earlier loop iterations; bridge via unknown.
      const priorPlan = plan as unknown as TurnPlan | null;
      if (
        priorPlan !== null &&
        (decision === "approve" || decision === "allow") &&
        (event.payload.kind === "plan_review" ||
          event.payload.planReview === true)
      ) {
        plan = { content: priorPlan.content, status: "approved" };
      }
    }

    if (event.kind === "plan_update") {
      const content = String(event.payload.content ?? "");
      const status =
        event.payload.status === "awaiting_approval"
          ? "awaiting_approval"
          : event.payload.status === "approved"
            ? "approved"
            : "drafting";
      plan = { content, status };
    }

    if (event.kind === "citations") {
      const items = event.payload.items;
      if (Array.isArray(items)) {
        const seenCitationUrls = new Set<string>();
        citations = items
          .map((item): CitationItem | null => {
            if (!item || typeof item !== "object") return null;
            const o = item as Record<string, unknown>;
            const url = String(o.url ?? "");
            if (!url) return null;
            return {
              url,
              title: typeof o.title === "string" ? o.title : undefined,
              snippet: typeof o.snippet === "string" ? o.snippet : undefined,
              source:
                o.source === "web" || o.source === "x" || o.source === "other"
                  ? o.source
                  : undefined,
            };
          })
          .filter((x): x is CitationItem => x != null)
          // Dedupe by URL: the same source cited twice in one turn renders an
          // identical card (snippet isn't shown) and would collide on the React
          // key={item.url}. Keep the first occurrence.
          .filter((c) => {
            if (seenCitationUrls.has(c.url)) return false;
            seenCitationUrls.add(c.url);
            return true;
          })
          .slice(0, 12);
      }
    }

    if (event.kind === "error" && !workerId) {
      primaryError = {
        eventId: event.id,
        message: eventSummary(event),
        createdAt: event.createdAt,
      };
    }

    const artifact = artifactFromEvent(event, task.id);
    if (artifact) eventArtifacts.push(artifact);
  }

  const observedState = statusObservations
    .sort(compareRunStateObservations)
    .reduce<RunState>(
      (previous, observation) =>
        mergeRunState(previous, observation.state),
      "queued",
    );
  const approval =
    [...pendingApprovals.values()]
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) ||
          a.eventId.localeCompare(b.eventId) ||
          a.approvalId.localeCompare(b.approvalId),
      )
      .at(-1) ?? null;
  // An unresolved canonical approval is the effective nonterminal state even
  // if a later materialized/status row says running (for example after A is
  // resolved while B remains). Terminal observations stay terminal so stale
  // approval events can never resurrect completed or cancelled work.
  const state: RunState =
    approval && !TERMINAL_RUN_STATE_RANK[observedState]
      ? "waiting_approval"
      : observedState;

  const artifactIdentity = (artifact: Artifact) => {
    const artifactPath = artifact.path?.trim().replace(/\\/g, "/");
    return artifactPath ? `path:${artifactPath}` : `id:${artifact.id}`;
  };
  const artifactMap = new Map<string, Artifact>();
  for (const artifact of eventArtifacts) {
    artifactMap.set(artifactIdentity(artifact), artifact);
  }
  // Durable artifacts are authoritative over their event-derived placeholder.
  for (const artifact of sourceArtifacts) {
    artifactMap.set(artifactIdentity(artifact), artifact);
  }
  const artifacts = [...artifactMap.values()].sort(compareStable);
  const sortedWorkers = Object.fromEntries(
    Object.entries(workers).sort(([a], [b]) => a.localeCompare(b)),
  );

  // CMD-4: prefer durable message goalSource, then task pass-through.
  let compactSource: string | undefined;
  for (const event of events) {
    if (event.kind !== "message") continue;
    if (nonBlank(event.payload.role) !== "user") continue;
    const gs = nonBlank(event.payload.goalSource);
    if (gs) compactSource = gs;
  }
  if (!compactSource) {
    const fromTask = nonBlank(task.goalSource);
    if (fromTask) compactSource = fromTask;
  }
  const expandedGoal = task.goal;
  const userMessage = compactSource ?? expandedGoal;
  const fullPrompt =
    compactSource && compactSource !== expandedGoal ? expandedGoal : undefined;

  return {
    id: task.id,
    taskId: task.id,
    userMessage,
    ...(fullPrompt !== undefined ? { fullPrompt } : {}),
    attachments: sourceAttachments.map((attachment) => ({ ...attachment })),
    attachmentsKnown,
    revisionOfTurnId: task.revisionOfTaskId,
    superseded: false,
    state,
    primaryRun: {
      id: task.id,
      state,
      startedAt: task.createdAt,
      completedAt: task.completedAt,
    },
    workers: sortedWorkers,
    answer,
    liveSummary: TERMINAL_RUN_STATE_RANK[state] ? null : liveSummary,
    work: foldRecoveredWorkEntries(
      coalesceBrowserToolActivity(events)
        .filter((event) => {
          if (event.kind !== "message") return true;
          if (nonBlank(event.payload.role) === "user") return false;
          const isAssistantText =
            nonBlank(event.payload.role) === "assistant" &&
            nonBlank(event.payload.channel) === "text";
          if (!isAssistantText) return true;
          return isProviderNoise(nonBlank(event.payload.text) ?? "");
        })
        .map(workEntryFrom),
      state,
    ),
    artifacts,
    approval,
    // A diagnostic error does not erase a recovered/completed result. Only the
    // primary task's terminal failure promotes its latest run-level error.
    error: state === "failed" ? primaryError : null,
    plan,
    citations,
  };
}

export function projectConversation(
  input: ConversationProjectionInput,
): ConversationSnapshot {
  const tasks = [...input.tasks].sort(compareStable);
  const supersededTaskIds = new Set(
    tasks
      .map((task) => task.revisionOfTaskId)
      .filter((taskId): taskId is string => Boolean(taskId)),
  );
  const turns = tasks.map((task) => {
    const attachmentMetadata =
      input.attachmentsByTask?.[task.id] !== undefined
        ? input.attachmentsByTask[task.id]
        : task.attachments;
    const attachmentsKnown = Array.isArray(attachmentMetadata);
    const events = input.eventsByTask[task.id] ?? [];
    const rewound = events.some(
      (e) =>
        e.kind === "status_change" &&
        (e.payload as { reason?: string }).reason === "rewound",
    );
    return {
      ...projectTurn(
        task,
        events,
        input.artifactsByTask?.[task.id] ?? [],
        attachmentsKnown ? attachmentMetadata : [],
        attachmentsKnown,
      ),
      // Edit-and-rerun (revisionOfTaskId) or ACP rewind both collapse the turn.
      superseded: supersededTaskIds.has(task.id) || rewound,
    };
  });
  const active = turns.filter(
    (turn) =>
      turn.state !== "done" &&
      turn.state !== "failed" &&
      turn.state !== "cancelled",
  );
  const activeTurnId = active.at(-1)?.id ?? null;
  const queued = (input.queued ?? [])
    .filter((item) => item.conversationId === input.conversationId)
    .sort(compareStable);

  return {
    conversationId: input.conversationId,
    title: input.title,
    turns,
    queued,
    activeTurnId,
    needsUserAction: turns.some(
      (turn) =>
        turn.state === "waiting_user" ||
        turn.state === "waiting_approval",
    ),
  };
}
