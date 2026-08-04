/**
 * Progressive activity timeline model.
 * Conversation messages stay primary; work folds into phases + live block.
 */

export type ActivityKind =
  | "user_message"
  | "assistant_message"
  | "phase"
  | "live_work"
  | "tool_receipt"
  | "worker_started"
  | "worker_activity"
  | "worker_message"
  | "worker_completed"
  | "worker_failed"
  | "approval"
  | "question"
  | "log";

export type ActivityEvent = {
  id: string;
  runId: string;
  workerId: string | null;
  kind: ActivityKind;
  phase: string | null;
  timestamp: string;
  summary: string;
  detail?: string;
  expandable?: boolean;
  receipt?: Record<string, unknown>;
};

export type WorkerRecord = {
  id: string;
  runId: string;
  parentWorkerId: string | null;
  label: string | null;
  objective: string | null;
  status: "running" | "done" | "failed" | "cancelled";
  currentActivity: string | null;
};

export type ProgressObservation = {
  timestamp: string;
  phaseOrder: 0 | 1;
  eventId: string;
};

export type ActivityStoreState = {
  events: ActivityEvent[];
  /** Durable event identity ledger; retained when timeline rows are folded. */
  seenEventIds: Record<string, true>;
  /** Latest accepted live/phase observation for each run. */
  latestProgressByRun: Record<string, ProgressObservation>;
  workers: Record<string, WorkerRecord>;
  /** When false, hide worker HUD (no truthful lifecycle events). */
  workersAvailable: boolean;
  liveSummary: string | null;
};

export function emptyActivityStore(): ActivityStoreState {
  return {
    events: [],
    seenEventIds: {},
    latestProgressByRun: {},
    workers: {},
    workersAvailable: false,
    liveSummary: null,
  };
}

export type ActivityInputEvent =
  | {
      type: "user_message" | "assistant_message";
      id: string;
      runId: string;
      timestamp: string;
      text: string;
    }
  | {
      type: "live_work";
      id: string;
      runId: string;
      timestamp: string;
      summary: string;
    }
  | {
      type: "phase_complete";
      id: string;
      runId: string;
      timestamp: string;
      summary: string;
      phase?: string;
    }
  | {
      type: "tool_receipt";
      id: string;
      runId: string;
      workerId?: string | null;
      timestamp: string;
      summary: string;
      receipt?: Record<string, unknown>;
    }
  | {
      type: "approval" | "question";
      id: string;
      runId: string;
      timestamp: string;
      summary: string;
    }
  | {
      type: "worker_started";
      id: string;
      runId: string;
      workerId: string;
      parentWorkerId?: string | null;
      timestamp: string;
      label?: string | null;
      objective?: string | null;
    }
  | {
      type: "worker_activity" | "worker_message";
      id: string;
      runId: string;
      workerId: string;
      parentWorkerId?: string | null;
      timestamp: string;
      summary: string;
    }
  | {
      type: "worker_completed" | "worker_failed";
      id: string;
      runId: string;
      workerId: string;
      parentWorkerId?: string | null;
      timestamp: string;
      summary?: string;
    }
  | {
      type: "log";
      id: string;
      runId: string;
      timestamp: string;
      summary: string;
      detail?: string;
    }
  | { type: "clear" };

export function reduceActivity(
  state: ActivityStoreState,
  event: ActivityInputEvent,
): ActivityStoreState {
  if (event.type === "clear") return emptyActivityStore();
  if (state.seenEventIds[event.id]) return state;

  if (event.type === "live_work" || event.type === "phase_complete") {
    const incoming: ProgressObservation = {
      timestamp: event.timestamp,
      phaseOrder: event.type === "phase_complete" ? 1 : 0,
      eventId: event.id,
    };
    const latest = state.latestProgressByRun[event.runId];
    if (latest && compareProgressObservations(incoming, latest) <= 0) {
      return rememberSeen(state, event.id);
    }
    state = {
      ...state,
      latestProgressByRun: {
        ...state.latestProgressByRun,
        [event.runId]: incoming,
      },
    };
  }

  if (event.type === "user_message" || event.type === "assistant_message") {
    return append(state, {
      id: event.id,
      runId: event.runId,
      workerId: null,
      kind: event.type,
      phase: null,
      timestamp: event.timestamp,
      summary: event.text,
    });
  }

  if (event.type === "live_work") {
    // Single live working block — replace previous live_work for same run.
    const withoutLive = {
      ...state,
      events: state.events.filter(
        (e) => !(e.kind === "live_work" && e.runId === event.runId),
      ),
    };
    return {
      ...append(withoutLive, {
        id: event.id,
        runId: event.runId,
        workerId: null,
        kind: "live_work",
        phase: null,
        timestamp: event.timestamp,
        summary: event.summary,
      }),
      liveSummary: event.summary,
    };
  }

  if (event.type === "phase_complete") {
    const withoutLive = {
      ...state,
      events: state.events.filter(
        (e) => !(e.kind === "live_work" && e.runId === event.runId),
      ),
      liveSummary: null,
    };
    return append(withoutLive, {
      id: event.id,
      runId: event.runId,
      workerId: null,
      kind: "phase",
      phase: event.phase ?? "work",
      timestamp: event.timestamp,
      summary: event.summary,
      expandable: true,
    });
  }

  if (event.type === "tool_receipt") {
    return append(state, {
      id: event.id,
      runId: event.runId,
      workerId: event.workerId ?? null,
      kind: "tool_receipt",
      phase: null,
      timestamp: event.timestamp,
      summary: event.summary,
      expandable: true,
      receipt: event.receipt,
    });
  }

  if (event.type === "approval" || event.type === "question") {
    return append(state, {
      id: event.id,
      runId: event.runId,
      workerId: null,
      kind: event.type,
      phase: null,
      timestamp: event.timestamp,
      summary: event.summary,
    });
  }

  if (event.type === "log") {
    return append(state, {
      id: event.id,
      runId: event.runId,
      workerId: null,
      kind: "log",
      phase: null,
      timestamp: event.timestamp,
      summary: event.summary,
      detail: event.detail,
      expandable: true,
    });
  }

  if (event.type === "worker_started") {
    const previous = state.workers[event.workerId];
    const workers = {
      ...state.workers,
      [event.workerId]: {
        id: event.workerId,
        runId: event.runId,
        parentWorkerId:
          previous?.parentWorkerId ?? event.parentWorkerId ?? null,
        label: event.label?.trim() || previous?.label || null,
        objective: event.objective ?? previous?.objective ?? null,
        status: previous?.status ?? ("running" as const),
        currentActivity:
          previous && previous.status !== "running"
            ? null
            : previous?.currentActivity ?? null,
      },
    };
    return append(
      { ...state, workers, workersAvailable: true },
      {
        id: event.id,
        runId: event.runId,
        workerId: event.workerId,
        kind: "worker_started",
        phase: null,
        timestamp: event.timestamp,
        summary: event.label?.trim() || event.workerId,
      },
    );
  }

  if (event.type === "worker_activity" || event.type === "worker_message") {
    const prev = state.workers[event.workerId];
    const worker = prev ?? {
      id: event.workerId,
      runId: event.runId,
      parentWorkerId: event.parentWorkerId ?? null,
      label: event.workerId,
      objective: null,
      status: "running" as const,
      currentActivity: null,
    };
    const workers = {
      ...state.workers,
      [event.workerId]: {
        ...worker,
        parentWorkerId:
          worker.parentWorkerId ?? event.parentWorkerId ?? null,
        currentActivity:
          worker.status === "running" ? event.summary : null,
      },
    };
    return append(
      { ...state, workers, workersAvailable: true },
      {
        id: event.id,
        runId: event.runId,
        workerId: event.workerId,
        kind: event.type,
        phase: null,
        timestamp: event.timestamp,
        summary: event.summary,
      },
    );
  }

  if (event.type === "worker_completed" || event.type === "worker_failed") {
    const prev = state.workers[event.workerId];
    const previousStatus = prev?.status ?? "running";
    const incomingStatus = event.type === "worker_completed" ? "done" : "failed";
    const statusRank = { running: 0, done: 1, cancelled: 2, failed: 3 } as const;
    const status =
      statusRank[incomingStatus] > statusRank[previousStatus]
        ? incomingStatus
        : previousStatus;
    const workers = {
      ...state.workers,
      [event.workerId]: {
        id: event.workerId,
        runId: prev?.runId ?? event.runId,
        parentWorkerId:
          prev?.parentWorkerId ?? event.parentWorkerId ?? null,
        label: prev?.label || event.workerId,
        objective: prev?.objective ?? null,
        status,
        currentActivity: null,
      },
    };
    return append(
      { ...state, workers, workersAvailable: true },
      {
        id: event.id,
        runId: event.runId,
        workerId: event.workerId,
        kind: event.type,
        phase: null,
        timestamp: event.timestamp,
        summary: event.summary ?? (event.type === "worker_completed" ? "Worker done" : "Worker failed"),
      },
    );
  }

  return state;
}

function append(
  state: ActivityStoreState,
  event: ActivityEvent,
): ActivityStoreState {
  if (state.seenEventIds[event.id]) return state;
  return {
    ...state,
    events: [...state.events, event],
    seenEventIds: { ...state.seenEventIds, [event.id]: true },
  };
}

function compareProgressObservations(
  a: ProgressObservation,
  b: ProgressObservation,
): number {
  return (
    a.timestamp.localeCompare(b.timestamp) ||
    a.phaseOrder - b.phaseOrder ||
    a.eventId.localeCompare(b.eventId)
  );
}

function rememberSeen(
  state: ActivityStoreState,
  eventId: string,
): ActivityStoreState {
  return {
    ...state,
    seenEventIds: { ...state.seenEventIds, [eventId]: true },
  };
}

/**
 * Timeline for the default conversational view: messages + live + phases +
 * approvals/questions. Tool receipts and logs stay expandable/secondary.
 */
export function visibleTimelineEvents(
  state: ActivityStoreState,
  opts?: { includeLogs?: boolean; includeTools?: boolean },
): ActivityEvent[] {
  return state.events.filter((e) => {
    if (e.kind === "log") return Boolean(opts?.includeLogs);
    if (e.kind === "tool_receipt") return Boolean(opts?.includeTools);
    return true;
  });
}

/**
 * Truthful workers only — never invent from parentTaskId follow-ups.
 */
export function workersForHud(state: ActivityStoreState): WorkerRecord[] {
  if (!state.workersAvailable) return [];
  return Object.values(state.workers);
}
