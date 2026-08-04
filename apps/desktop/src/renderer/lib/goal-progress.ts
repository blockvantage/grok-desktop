/**
 * C1: Working toward… progress line from goal / update events.
 * Hide when no goal events (headless-degraded / missing streams).
 */

import { t } from "@/i18n/active";
import { softenSavedFileStatus } from "@/lib/artifact-availability";

export type GoalProgressView = {
  /** Product line under the title. */
  line: string;
  /** Raw objective if present. */
  objective: string | null;
  /** Latest status update snippet. */
  status: string | null;
  source: "goal_event" | "task_goal" | "none";
};

export type GoalEventLike = {
  kind: string;
  payload?: Record<string, unknown> | null;
};

/** Setup noise that should not stick as the live "working" subtitle. */
const STALE_STATUS = [
  /^session ready\b/i,
  /^starting (session|grok)\b/i,
  /^grok (cli|build) session\b/i,
  /^probing capabilities\b/i,
  /^isolated grok profile\b/i,
  /^folder not trusted\b/i,
  /^protection$/i,
  /^starting grok…/i,
  /^grok cli \d/i,
];

/**
 * Project a single "Working toward…" line from events + optional task goal.
 * Prefer structured goal/update payloads; fall back to task.goal once.
 * Skips sticky setup lines once real work starts; collapses duplicated clauses.
 */
export function projectGoalProgress(input: {
  events: readonly GoalEventLike[];
  taskGoal?: string | null;
  /** When true, show static task goal even without events (headless ok). */
  allowTaskGoalFallback?: boolean;
  /**
   * When true (typically terminal tasks), soften "Saved N file(s) under …"
   * so headers do not overclaim files that may no longer be on disk.
   */
  softenSavedClaims?: boolean;
}): GoalProgressView | null {
  let objective: string | null = null;
  let status: string | null = null;
  let sawLiveWork = false;

  for (const ev of input.events) {
    const p = ev.payload ?? {};
    if (
      ev.kind === "goal_update" ||
      ev.kind === "goal" ||
      (ev.kind === "step" &&
        String(p.title ?? "")
          .toLowerCase()
          .includes("goal"))
    ) {
      const obj = str(p.objective ?? p.goal ?? p.title);
      const st = str(p.status ?? p.message ?? p.progress);
      if (obj && !isStaleStatus(obj)) objective = obj;
      if (st && !isStaleStatus(st)) {
        status = st;
        sawLiveWork = true;
      }
    }
    if (ev.kind === "step") {
      const title = str(p.title);
      if (!title) continue;
      if (isStaleStatus(title)) {
        // Early setup only — keep until something better arrives.
        if (!sawLiveWork && !status) status = title;
        continue;
      }
      if (p.status === "start" || p.status === "running" || !p.status) {
        if (status !== title) status = title;
        sawLiveWork = true;
      }
    }
    if (ev.kind === "message") {
      const channel = String(p.channel ?? "");
      const text = str(p.text);
      // Short product-facing assistant text as live status while running.
      if (
        text &&
        channel === "text" &&
        text.length <= 140 &&
        !isStaleStatus(text)
      ) {
        status = text;
        sawLiveWork = true;
      }
    }
  }

  // Once we have an objective or live work, drop leftover setup-only status.
  if (status && isStaleStatus(status) && (objective || sawLiveWork)) {
    status = null;
  }

  // Collapse when objective equals status.
  if (objective && status && normalize(objective) === normalize(status)) {
    status = null;
  }

  if (input.softenSavedClaims) {
    status = softenSavedFileStatus(status, true);
    objective = softenSavedFileStatus(objective, true);
  }

  const prefix = t("goalProgress.workingToward");

  if (objective || status) {
    const line = status
      ? objective
        ? `${prefix} ${objective} — ${status}`
        : `${prefix} ${status}`
      : `${prefix} ${objective}`;
    return {
      line: collapseRepeatedClause(line, prefix),
      objective,
      status,
      source: "goal_event",
    };
  }

  if (input.allowTaskGoalFallback !== false && input.taskGoal?.trim()) {
    const g = input.taskGoal.trim();
    const short = g.length > 80 ? `${g.slice(0, 80)}…` : g;
    return {
      line: `${prefix} ${short}`,
      objective: short,
      status: null,
      source: "task_goal",
    };
  }

  return null;
}

function isStaleStatus(s: string): boolean {
  const t = s.trim();
  return STALE_STATUS.some((re) => re.test(t));
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The prefix is a translated string — escape it before use in a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collapse "A — A" / repeated "Session ready — Session ready" style duplication. */
function collapseRepeatedClause(line: string, prefix: string): string {
  const m = line.match(
    new RegExp(`^(${escapeRe(prefix)}\\s+)(.+?)\\s+[—–-]\\s+\\2\\s*$`, "i"),
  );
  if (m) return `${m[1]}${m[2]}`;
  const parts = line.split(/\s+[—–-]\s+/);
  if (parts.length >= 2) {
    const uniq: string[] = [];
    for (const p of parts) {
      if (!uniq.some((u) => normalize(u) === normalize(p))) uniq.push(p);
    }
    if (uniq.length < parts.length) return uniq.join(" — ");
  }
  return line;
}
