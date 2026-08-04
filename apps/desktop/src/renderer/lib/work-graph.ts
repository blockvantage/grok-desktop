/**
 * Compact task work graph — product-facing stages derived from real events.
 * Does not invent certainty: sparse evidence keeps stages coarse.
 */

export const WORK_GRAPH_STAGES = [
  "plan",
  "research",
  "edit",
  "review",
  "deliver",
] as const;

export type WorkGraphStage = (typeof WORK_GRAPH_STAGES)[number];

/** Product-facing run states (not raw event kinds). */
export type WorkGraphProductState =
  | "working"
  | "waiting_for_approval"
  | "retrying"
  | "recovered"
  | "blocked"
  | "done"
  | "failed"
  | "cancelled";

export type WorkGraphEventLike = {
  kind: string;
  payload?: Record<string, unknown> | null;
  createdAt?: string;
};

export type WorkGraphTaskLike = {
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
};

export type WorkGraphView = {
  /** Stable ordered stages that have evidence (may be empty early). */
  stagesReached: WorkGraphStage[];
  /** Current stage when evidence supports one; null when unknown. */
  currentStage: WorkGraphStage | null;
  /** Human label for the current stage (or generic working). */
  stageLabel: string;
  productState: WorkGraphProductState;
  /** Short product status for the current-work band. */
  statusText: string;
  /** ISO start for elapsed timer (task createdAt when valid). */
  elapsedStartIso: string | null;
  /** True when user action is required (approval / waiting_user). */
  needsYou: boolean;
  /** Optional required action copy when needsYou. */
  requiredAction: string | null;
  /** Jargon-free summary; details stay expandable elsewhere. */
  detailText: string | null;
};

const STAGE_LABELS: Record<WorkGraphStage, string> = {
  plan: "Plan",
  research: "Research",
  edit: "Edit",
  review: "Review",
  deliver: "Deliver",
};

const PRODUCT_STATUS: Record<WorkGraphProductState, string> = {
  working: "Working",
  waiting_for_approval: "Waiting for your approval",
  retrying: "Retrying",
  recovered: "Recovered — continuing",
  blocked: "Blocked",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Tool name fragments → stage (conservative; prefer known tools). */
const RESEARCH_TOOLS =
  /^(web_|browser_|search|fetch|read_url|x_search|web_search|browse)/i;
const EDIT_TOOLS =
  /^(write|edit|apply_|patch|create_file|str_replace|search_replace|file_write|fs_write|mkdir|delete_file)/i;
const REVIEW_TOOLS = /^(review|lint|test|typecheck|diff|git_diff)/i;

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

function toolName(payload: Record<string, unknown> | null | undefined): string {
  return (
    str(payload?.tool) ??
    str(payload?.name) ??
    str(payload?.toolName) ??
    ""
  );
}

/**
 * Infer a single stage signal from one event. Returns null when the event
 * does not support a stage claim (no invention).
 */
export function stageHintFromEvent(
  event: WorkGraphEventLike,
): WorkGraphStage | null {
  const kind = event.kind;
  const p = event.payload ?? {};
  const tool = toolName(p);
  const title = (
    str(p.title) ??
    str(p.summary) ??
    str(p.message) ??
    str(p.text) ??
    str(p.objective) ??
    ""
  ).toLowerCase();

  if (kind === "plan_update" || kind === "plan") return "plan";
  if (
    kind === "approval_required" &&
    (p.kind === "plan_review" || p.planReview === true)
  ) {
    return "review";
  }
  if (kind === "citations") return "research";
  if (kind === "artifact_created") return "deliver";
  if (kind === "done" || kind === "task_completed") return "deliver";

  if (kind === "tool_request" || kind === "tool_result") {
    if (RESEARCH_TOOLS.test(tool)) return "research";
    if (EDIT_TOOLS.test(tool)) return "edit";
    if (REVIEW_TOOLS.test(tool)) return "review";
    // Generic tools do not claim a stage.
    return null;
  }

  if (kind === "step" || kind === "goal_update" || kind === "goal") {
    // Check specific stage verbs first (review before edit so "reviewing the patch"
    // is not claimed by a bare "patch" token).
    if (/\b(plan(ning)?|outline)\b/.test(title)) return "plan";
    if (/\b(review(ing)?|verif(y|ying)|check(ing)?|test(ing)?|lint(ing)?)\b/.test(title))
      return "review";
    if (
      /\b(research(ing)?|search(ing)?|brows(e|ing)|read(ing)?|investigate|look up)\b/.test(
        title,
      )
    ) {
      return "research";
    }
    if (
      /\b(edit(ing)?|writ(e|ing)|implement(ing)?|cod(e|ing)|fix(ing)?|apply[_ ]?patch|create file)\b/.test(
        title,
      )
    ) {
      return "edit";
    }
    if (
      /\b(deliver(ing)?|ship(ping)?|finaliz(e|ing)|package|summar(y|ize|ising|izing))\b/.test(
        title,
      )
    ) {
      return "deliver";
    }
    return null;
  }

  if (kind.startsWith("worker_")) {
    const label = (
      str(p.label) ??
      str(p.objective) ??
      str(p.summary) ??
      ""
    ).toLowerCase();
    if (/\b(plan(ner|ning)?)\b/.test(label)) return "plan";
    if (/\b(research(er|ing)?|search(er|ing)?|brows(e|ing))\b/.test(label))
      return "research";
    if (/\b(edit(or|ing)?|writ(er|ing)|cod(er|ing)|implement(er|ing)?)\b/.test(label))
      return "edit";
    if (/\b(review(er|ing)?|critic|qa|verif(y|ying))\b/.test(label)) return "review";
    if (/\b(deliver(y|ing)?|publish(er|ing)?|finaliz(e|ing))\b/.test(label))
      return "deliver";
    return null;
  }

  if (kind === "message") {
    const channel = str(p.channel);
    const text = (str(p.text) ?? "").toLowerCase();
    if (channel === "text" && text) {
      if (/\b(researching|searching|browsing)\b/.test(text)) return "research";
      if (/\b(editing|writing|implementing)\b/.test(text)) return "edit";
      if (/\b(reviewing|verifying)\b/.test(text)) return "review";
    }
  }

  return null;
}

/**
 * Walk events chronologically and collect stages with evidence.
 * Current stage is the latest non-null hint (stable, no backtracking invent).
 */
export function stagesFromEvents(
  events: readonly WorkGraphEventLike[],
): { stagesReached: WorkGraphStage[]; currentStage: WorkGraphStage | null } {
  const reached: WorkGraphStage[] = [];
  let current: WorkGraphStage | null = null;
  for (const ev of events) {
    const hint = stageHintFromEvent(ev);
    if (!hint) continue;
    if (!reached.includes(hint)) reached.push(hint);
    current = hint;
  }
  // Keep reached in canonical order for the rail.
  const ordered = WORK_GRAPH_STAGES.filter((s) => reached.includes(s));
  return { stagesReached: ordered, currentStage: current };
}

function productStateFromTaskStatus(
  status: string | null | undefined,
  events: readonly WorkGraphEventLike[],
): WorkGraphProductState {
  const s = (status ?? "").toLowerCase();
  if (s === "waiting_approval" || s === "waiting_user") {
    return "waiting_for_approval";
  }
  if (s === "blocked") return "blocked";
  if (s === "done") return "done";
  if (s === "failed") return "failed";
  if (s === "cancelled") return "cancelled";

  // Scan for retry/recovery signals without inventing mid-run certainty.
  let sawFailure = false;
  let sawRecover = false;
  let sawRetry = false;
  for (const ev of events) {
    const kind = ev.kind;
    const p = ev.payload ?? {};
    const reason = (str(p.reason) ?? str(p.message) ?? "").toLowerCase();
    if (kind === "error") sawFailure = true;
    if (kind === "status_change") {
      const to = (str(p.status) ?? str(p.to) ?? "").toLowerCase();
      if (to === "failed") sawFailure = true;
      if (
        to === "running" ||
        to === "queued" ||
        reason.includes("recover") ||
        reason.includes("retry") ||
        reason.includes("lease")
      ) {
        if (sawFailure || reason.includes("recover") || reason.includes("retry")) {
          if (reason.includes("retry") || reason.includes("attempt")) {
            sawRetry = true;
          } else if (reason.includes("recover") || sawFailure) {
            sawRecover = true;
          }
        }
      }
    }
    if (
      kind === "log" &&
      (reason.includes("retry") || reason.includes("recover"))
    ) {
      if (reason.includes("retry")) sawRetry = true;
      else sawRecover = true;
    }
  }

  if ((s === "running" || s === "queued") && sawRetry) return "retrying";
  if ((s === "running" || s === "queued") && sawRecover) return "recovered";
  if (s === "running" || s === "queued") return "working";
  return "working";
}

function statusTextFor(
  productState: WorkGraphProductState,
  currentStage: WorkGraphStage | null,
  events: readonly WorkGraphEventLike[],
): string {
  if (productState === "waiting_for_approval") {
    return PRODUCT_STATUS.waiting_for_approval;
  }
  if (productState === "blocked") return PRODUCT_STATUS.blocked;
  if (productState === "retrying") return PRODUCT_STATUS.retrying;
  if (productState === "recovered") return PRODUCT_STATUS.recovered;
  if (productState === "done") return PRODUCT_STATUS.done;
  if (productState === "failed") return PRODUCT_STATUS.failed;
  if (productState === "cancelled") return PRODUCT_STATUS.cancelled;

  // Prefer a short live caption from the latest useful event.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    const p = ev.payload ?? {};
    if (ev.kind === "step") {
      const title = str(p.title);
      if (title && !/^session ready/i.test(title) && !/^starting /i.test(title)) {
        return title.length > 80 ? `${title.slice(0, 80)}…` : title;
      }
    }
    if (ev.kind === "worker_activity" || ev.kind === "worker_message") {
      const summary = str(p.summary) ?? str(p.text);
      if (summary) {
        return summary.length > 80 ? `${summary.slice(0, 80)}…` : summary;
      }
    }
    if (ev.kind === "tool_request") {
      const tool = toolName(p);
      if (tool) {
        const human = tool.replace(/^browser_/, "Browsing · ").replace(/_/g, " ");
        return human.charAt(0).toUpperCase() + human.slice(1);
      }
    }
  }

  if (currentStage) {
    return `${STAGE_LABELS[currentStage]}…`;
  }
  return PRODUCT_STATUS.working;
}

function requiredActionFor(
  productState: WorkGraphProductState,
  taskStatus: string | null | undefined,
  events: readonly WorkGraphEventLike[],
): string | null {
  if (productState !== "waiting_for_approval") return null;
  const s = (taskStatus ?? "").toLowerCase();
  if (s === "waiting_user") {
    return "Answer the question to continue";
  }
  // Prefer approval summary when present.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.kind === "approval_required") {
      const reason = str(ev.payload?.reason) ?? str(ev.payload?.summary);
      if (reason) {
        return reason.length > 100 ? `${reason.slice(0, 100)}…` : reason;
      }
    }
    if (ev.kind === "user_question" || ev.kind === "question") {
      const prompt = str(ev.payload?.prompt) ?? str(ev.payload?.text);
      if (prompt) {
        return prompt.length > 100 ? `${prompt.slice(0, 100)}…` : prompt;
      }
    }
  }
  return "Approve or reject to continue";
}

function detailFromWorkers(
  events: readonly WorkGraphEventLike[],
): string | null {
  const active: string[] = [];
  const statusByWorker = new Map<string, string>();
  for (const ev of events) {
    if (!ev.kind.startsWith("worker_")) continue;
    const id = str(ev.payload?.workerId);
    if (!id) continue;
    if (ev.kind === "worker_started") {
      const label =
        str(ev.payload?.label) ?? str(ev.payload?.objective) ?? "Helper";
      statusByWorker.set(id, label);
    } else if (ev.kind === "worker_activity" || ev.kind === "worker_message") {
      const summary = str(ev.payload?.summary) ?? str(ev.payload?.text);
      if (summary) statusByWorker.set(id, summary);
    } else if (ev.kind === "worker_completed" || ev.kind === "worker_failed") {
      statusByWorker.delete(id);
    }
  }
  for (const label of statusByWorker.values()) {
    active.push(label);
  }
  if (active.length === 0) return null;
  if (active.length === 1) return active[0]!;
  return `${active.length} helpers active`;
}

/**
 * Project a compact work-graph view for a task from real events + task row.
 */
export function projectWorkGraph(input: {
  events: readonly WorkGraphEventLike[];
  task?: WorkGraphTaskLike | null;
  /** Override product status when caller already resolved approval parking. */
  statusOverride?: string | null;
}): WorkGraphView {
  const events = input.events;
  const taskStatus = input.statusOverride ?? input.task?.status ?? null;
  const { stagesReached, currentStage } = stagesFromEvents(events);
  const productState = productStateFromTaskStatus(taskStatus, events);
  const needsYou = productState === "waiting_for_approval";
  const stageLabel = currentStage
    ? STAGE_LABELS[currentStage]
    : productState === "waiting_for_approval"
      ? "Needs you"
      : productState === "blocked"
        ? "Blocked"
        : "Working";

  const created = input.task?.createdAt?.trim();
  const elapsedStartIso =
    created && !Number.isNaN(Date.parse(created)) ? created : null;

  return {
    stagesReached,
    currentStage,
    stageLabel,
    productState,
    statusText: statusTextFor(productState, currentStage, events),
    elapsedStartIso,
    needsYou,
    requiredAction: requiredActionFor(productState, taskStatus, events),
    detailText: detailFromWorkers(events),
  };
}

export function workGraphStageLabel(stage: WorkGraphStage): string {
  return STAGE_LABELS[stage];
}

export function workGraphProductStatusLabel(
  state: WorkGraphProductState,
): string {
  return PRODUCT_STATUS[state];
}

/**
 * Mark failure/error work rows as diagnostic when the run recovered and
 * continued (or finished successfully). Keeps full audit in details.
 */
export function foldRecoveredWorkEntries<
  T extends {
    kind: string;
    timestamp: string;
    diagnostic: boolean;
    payload: Record<string, unknown>;
  },
>(entries: T[], finalState: string): T[] {
  if (entries.length === 0) return entries;

  // Terminal failure/cancel: leave failure rows visible (not diagnostic).
  if (finalState === "failed" || finalState === "cancelled") return entries;

  const canFold =
    finalState === "done" ||
    finalState === "running" ||
    finalState === "queued" ||
    finalState === "waiting_approval" ||
    finalState === "waiting_user" ||
    finalState === "blocked";
  if (!canFold) return entries;

  // If we never saw a run-level error/failure, nothing to fold.
  const hasRecoverableFailure = entries.some(
    (e) =>
      e.kind === "error" ||
      e.kind === "worker_failed" ||
      (e.kind === "status_change" &&
        (String(e.payload.status ?? e.payload.to ?? "") === "failed" ||
          /retry|recover/i.test(String(e.payload.reason ?? "")))),
  );
  if (!hasRecoverableFailure) return entries;

  // Find last recovery signal (running after failure, or non-failed terminal).
  let lastFailureIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (
      e.kind === "error" ||
      e.kind === "worker_failed" ||
      (e.kind === "status_change" &&
        String(e.payload.status ?? e.payload.to ?? "") === "failed")
    ) {
      lastFailureIdx = i;
    }
  }
  if (lastFailureIdx < 0) return entries;

  const laterProgress = entries.slice(lastFailureIdx + 1).some((e) => {
    if (e.kind === "status_change") {
      const to = String(e.payload.status ?? e.payload.to ?? "");
      return to === "running" || to === "queued" || to === "done";
    }
    return (
      e.kind === "step" ||
      e.kind === "tool_request" ||
      e.kind === "message" ||
      e.kind === "artifact_created" ||
      e.kind === "worker_started" ||
      e.kind === "worker_activity"
    );
  });

  if (!laterProgress && finalState !== "done" && finalState !== "running") {
    // Parked after failure without continuation — leave failures visible.
    if (finalState !== "queued") return entries;
  }

  return entries.map((e, idx) => {
    if (idx > lastFailureIdx) return e;
    const isFailureRow =
      e.kind === "error" ||
      e.kind === "worker_failed" ||
      (e.kind === "status_change" &&
        String(e.payload.status ?? e.payload.to ?? "") === "failed") ||
      (e.kind === "tool_result" && e.payload.ok === false);
    if (!isFailureRow) return e;
    if (e.diagnostic) return e;
    return { ...e, diagnostic: true };
  });
}
