/**
 * Pure transcript/event payload builders for TaskRunner.handleEvent
 * (Phase 6 extract — no I/O, no TaskService).
 */

import type { NormalizedEngineEvent } from "../engine-types.js";

export type MessagePayload = {
  role: "assistant" | "user";
  text: string;
  channel: "text" | "thought";
};

export type StepPayload = {
  title: string;
  status: "start" | "end";
};

export type ToolRequestPayload = {
  id: string;
  tool: string;
  path?: string;
  command?: string;
  meta?: Record<string, unknown>;
};

export type ToolResultPayload = {
  id: string;
  ok: boolean;
  output: string;
};

export type ArtifactCreatedPayload = {
  id: string;
  title: string;
  path: string;
  kind: "file" | "report" | "media" | "card";
};

export type ErrorPayload = {
  message: string;
};

export type WorkerEventPayload = {
  workerId: string;
  label?: string;
  objective?: string;
  summary?: string;
  text?: string;
  parentWorkerId?: string;
};

type WorkerEvent = Extract<
  NormalizedEngineEvent,
  {
    type:
      | "worker_started"
      | "worker_activity"
      | "worker_message"
      | "worker_completed"
      | "worker_failed";
  }
>;

/** Cap run_progress titles so step rows stay compact. */
export const RUN_PROGRESS_TITLE_MAX = 200;

export function messageEventPayload(
  event: Extract<NormalizedEngineEvent, { type: "message" }>,
): MessagePayload {
  return {
    role: event.role,
    text: event.text,
    channel: event.channel ?? "text",
  };
}

/**
 * Transient run_progress → step payload (never assistant transcript).
 */
export function runProgressStepPayload(
  event: Extract<NormalizedEngineEvent, { type: "run_progress" }>,
  maxLen: number = RUN_PROGRESS_TITLE_MAX,
): StepPayload {
  return {
    title: event.message.slice(0, maxLen),
    status: "start",
  };
}

export function stepEventPayload(
  event: Extract<NormalizedEngineEvent, { type: "step" }>,
): StepPayload {
  return {
    title: event.title,
    status: event.status,
  };
}

export function toolRequestEventPayload(
  event: Extract<NormalizedEngineEvent, { type: "tool_request" }>,
): ToolRequestPayload {
  return {
    id: event.id,
    tool: event.tool,
    path: event.path,
    command: event.command,
    meta: event.meta,
  };
}

export function toolResultEventPayload(
  event: Extract<NormalizedEngineEvent, { type: "tool_result" }>,
): ToolResultPayload {
  return {
    id: event.id,
    ok: event.ok,
    output: event.output,
  };
}

export function toolResultDeniedPayload(
  event: Extract<NormalizedEngineEvent, { type: "tool_request" }>,
  reason: string,
): ToolResultPayload {
  return {
    id: event.id,
    ok: false,
    output: reason,
  };
}

export function toolResultUserRejectedPayload(
  event: Extract<NormalizedEngineEvent, { type: "tool_request" }>,
): ToolResultPayload {
  return {
    id: event.id,
    ok: false,
    output: "User rejected",
  };
}

export function artifactCreatedEventPayload(
  event: Extract<NormalizedEngineEvent, { type: "artifact" }>,
  id: string,
): ArtifactCreatedPayload {
  return {
    id,
    title: event.title,
    path: event.path,
    kind: event.kind,
  };
}

export function errorEventPayload(
  event: Extract<NormalizedEngineEvent, { type: "error" }>,
): ErrorPayload {
  return { message: event.message };
}

export function workerEventPayload(event: WorkerEvent): WorkerEventPayload {
  const payload: WorkerEventPayload = { workerId: event.workerId };
  if ("label" in event && event.label !== undefined) {
    payload.label = event.label;
  }
  if ("objective" in event && event.objective !== undefined) {
    payload.objective = event.objective;
  }
  if ("summary" in event && event.summary !== undefined) {
    payload.summary = event.summary;
  }
  if ("text" in event && event.text !== undefined) {
    payload.text = event.text;
  }
  if (event.parentWorkerId !== undefined) {
    payload.parentWorkerId = event.parentWorkerId;
  }
  return payload;
}

/**
 * Done summary → assistant message payload, or null when useless.
 */
export function doneSummaryMessagePayload(
  summary: string | null | undefined,
  isUseful: (s: string | null | undefined) => boolean,
): MessagePayload | null {
  if (!isUseful(summary)) return null;
  return {
    role: "assistant",
    text: (summary ?? "").trim(),
    channel: "text",
  };
}
