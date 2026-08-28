/**
 * ACP MonitorEvent → Watch until… strip (Phase 3.5 C6).
 * Unknown envelopes never throw.
 */

export const MONITOR_STATUSES = [
  "running",
  "done",
  "failed",
  "cancelled",
  "other",
] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];

export type MonitorEventView = {
  monitorId: string;
  description: string;
  line: string | null;
  status: MonitorStatus;
};

export type WatchUntilView = {
  monitorId: string;
  description: string;
  lastLine: string | null;
  status: MonitorStatus;
};

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

export function decodeMonitorStatus(raw: unknown): MonitorStatus {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (t === "running" || t === "started" || t === "active" || t === "watching") {
    return "running";
  }
  if (t === "done" || t === "completed" || t === "succeeded" || t === "ok") {
    return "done";
  }
  if (t === "failed" || t === "error") return "failed";
  if (t === "cancelled" || t === "canceled" || t === "stopped") {
    return "cancelled";
  }
  return "other";
}

export function decodeMonitorEvent(raw: unknown): MonitorEventView | null {
  const p = rec(raw);
  if (!p) return null;
  const inner = rec(p.payload) ?? p;
  const blob = [
    p.sessionUpdate,
    p.type,
    inner.sessionUpdate,
    inner.type,
    p.title,
  ]
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase();
  const looksMonitor =
    blob.includes("monitor") ||
    blob.includes("watch") ||
    str(inner.monitorId) != null ||
    str(inner.monitor_id) != null;
  if (!looksMonitor) return null;
  const monitorId =
    str(inner.monitorId) ??
    str(inner.monitor_id) ??
    str(inner.taskId) ??
    str(inner.task_id) ??
    str(inner.id) ??
    "monitor";
  const description =
    str(inner.description) ??
    str(inner.title) ??
    str(inner.summary) ??
    "Watch until…";
  const line =
    str(inner.line) ??
    str(inner.text) ??
    str(inner.message) ??
    str(inner.output);
  return {
    monitorId,
    description,
    line,
    status: decodeMonitorStatus(
      inner.status ?? inner.state ?? inner.kind ?? p.status,
    ),
  };
}

export type MonitorEventLike = {
  kind?: string;
  type?: string;
  title?: string;
  payload?: Record<string, unknown> | null;
};

export function isMonitorEvent(event: MonitorEventLike): boolean {
  const p = rec(event.payload) ?? {};
  const blob = [event.kind, event.type, event.title, p.title, p.sessionUpdate]
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase();
  return blob.includes("monitor") || decodeMonitorEvent(p) != null;
}

export function foldWatchUntil(
  events: readonly MonitorEventLike[],
): WatchUntilView | null {
  let latest: WatchUntilView | null = null;
  for (const event of events) {
    const decoded =
      decodeMonitorEvent(event.payload) ??
      (isMonitorEvent(event) ? decodeMonitorEvent({ ...event, ...(event.payload ?? {}) }) : null);
    if (!decoded) continue;
    latest = {
      monitorId: decoded.monitorId,
      description: decoded.description,
      lastLine: decoded.line,
      status: decoded.status === "other" && latest !== null
        ? latest.status
        : decoded.status,
    };
  }
  return latest;
}

export function watchUntilStopPrompt(view: WatchUntilView): string {
  const id = view.monitorId.trim();
  if (!id || id === "monitor") return "Stop watching this.";
  return `Stop watching ${id}.`;
}
