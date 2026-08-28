/**
 * WorkflowUpdated fold for the deep-research / workflow run panel (Phase 3.1).
 * Locale-free: UI adds copy. Unknown extra fields are ignored.
 */

export type WorkflowPhaseView = {
  id: string;
  title: string;
  active: boolean;
};

export type WorkflowAgentView = {
  id: string;
  label: string;
  status: string | null;
  summary: string | null;
};

export type WorkflowRunView = {
  handle: string;
  objective: string | null;
  currentPhase: string | null;
  phases: WorkflowPhaseView[];
  agents: WorkflowAgentView[];
  agentsUsed: number | null;
  agentsReserved: number | null;
  remaining: number | null;
  pauseMessage: string | null;
  resultSummary: string | null;
  lastEvent: string | null;
  status: "running" | "paused" | "done";
};

export type WorkflowEventLike = {
  kind?: string;
  payload?: Record<string, unknown> | null;
};

export type WorkflowControlAction = "pause" | "resume" | "stop";

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isWorkflowEvent(event: WorkflowEventLike): boolean {
  const p = rec(event.payload) ?? {};
  const title = str(p.title) ?? "";
  const kind = String(event.kind ?? "");
  const token = `${kind} ${title} ${str(p.sessionUpdate) ?? ""}`.toLowerCase();
  return (
    kind === "workflow_update" ||
    kind === "workflow_updated" ||
    title === "workflow_update" ||
    token.includes("workflowupdated") ||
    token.includes("workflow_updated")
  );
}

function phasesFrom(raw: unknown, current: string | null): WorkflowPhaseView[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    if (typeof item === "string") {
      const title = item.trim() || `phase-${i + 1}`;
      return {
        id: title,
        title,
        active: Boolean(current && current === title),
      };
    }
    const row = rec(item) ?? {};
    const title =
      str(row.title) ?? str(row.name) ?? str(row.id) ?? `phase-${i + 1}`;
    const id = str(row.id) ?? title;
    const active =
      row.active === true ||
      Boolean(current && (current === title || current === id));
    return { id, title, active };
  });
}

function agentsFrom(raw: unknown): WorkflowAgentView[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    const row = rec(item) ?? {};
    const label =
      str(row.label) ??
      str(row.name) ??
      str(row.role) ??
      str(row.id) ??
      `agent-${i + 1}`;
    return {
      id: str(row.id) ?? label,
      label,
      status: str(row.status) ?? str(row.state),
      summary: str(row.summary) ?? str(row.detail) ?? str(row.last_event),
    };
  });
}

export function decodeWorkflowPayload(
  payload: Record<string, unknown> | null | undefined,
): WorkflowRunView | null {
  const p = rec(payload);
  if (!p) return null;
  const inner = rec(p.workflow) ?? rec(p.state) ?? p;
  const handle =
    str(inner.handle) ??
    str(inner.name) ??
    str(inner.run_id) ??
    str(inner.runId) ??
    str(p.handle) ??
    str(p.title) ??
    null;
  const objective = str(inner.objective) ?? str(inner.goal) ?? str(p.objective);
  const currentPhase =
    str(inner.current_phase) ??
    str(inner.currentPhase) ??
    str(p.current_phase);
  const pauseMessage = str(inner.pause_message) ?? str(inner.pauseMessage);
  const resultSummary = str(inner.result_summary) ?? str(inner.resultSummary);
  const lastEvent =
    str(inner.last_event) ??
    str(inner.lastEvent) ??
    str(inner.last_event_detail);
  const used = num(inner.agents_used ?? inner.agentsUsed);
  const reserved = num(inner.agents_reserved ?? inner.agentsReserved);
  const budget = num(inner.agent_budget ?? inner.agentBudget);
  const remaining =
    budget != null && used != null ? Math.max(0, budget - used) : null;
  const phases = phasesFrom(inner.phases ?? p.phases, currentPhase);
  const agents = agentsFrom(inner.agents ?? inner.active_agents ?? p.agents);
  if (
    !handle &&
    !objective &&
    phases.length === 0 &&
    agents.length === 0 &&
    used == null
  ) {
    return null;
  }
  let status: WorkflowRunView["status"] = "running";
  if (pauseMessage) status = "paused";
  else if (resultSummary && !currentPhase) status = "done";
  return {
    handle: handle ?? "workflow",
    objective,
    currentPhase,
    phases,
    agents,
    agentsUsed: used,
    agentsReserved: reserved,
    remaining,
    pauseMessage,
    resultSummary,
    lastEvent,
    status,
  };
}

export function foldWorkflowRun(
  events: readonly WorkflowEventLike[],
): WorkflowRunView | null {
  let latest: WorkflowRunView | null = null;
  for (const event of events) {
    if (!isWorkflowEvent(event)) continue;
    const next = decodeWorkflowPayload(event.payload);
    if (next) latest = next;
  }
  return latest;
}

/** Prompt the agent-side `/workflow` builtin (no dedicated ACP control RPC). */
export function workflowControlPrompt(
  action: WorkflowControlAction,
  handle: string,
): string {
  const h = handle.trim();
  if (!h || h === "workflow") return `/workflow ${action}`;
  return `/workflow ${action} ${h}`;
}
