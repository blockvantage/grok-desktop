/**
 * Overnight schedule digest — summarize recent scheduled runs for morning Home.
 */

export type ScheduleRunLike = {
  scheduleId: string;
  scheduleName: string;
  taskId?: string | null;
  status: string;
  finishedAt: string;
  goal?: string | null;
};

export type ScheduleDigestLine = {
  scheduleId: string;
  scheduleName: string;
  status: "done" | "failed" | "other";
  taskId: string | null;
  summary: string;
};

export type ScheduleDigest = {
  lines: ScheduleDigestLine[];
  doneCount: number;
  failedCount: number;
  headline: string;
};

function classify(status: string): "done" | "failed" | "other" {
  const s = status.toLowerCase();
  if (s === "done" || s === "completed" || s === "succeeded") return "done";
  if (s === "failed" || s === "error") return "failed";
  return "other";
}

/**
 * Digest runs that finished in the lookback window (default 16h — overnight).
 */
export function buildScheduleDigest(input: {
  runs: ScheduleRunLike[];
  now: Date;
  lookbackHours?: number;
  limit?: number;
}): ScheduleDigest {
  const lookbackMs = (input.lookbackHours ?? 16) * 60 * 60 * 1000;
  const limit = input.limit ?? 6;
  const cutoff = input.now.getTime() - lookbackMs;

  const recent = input.runs
    .filter((r) => {
      const t = Date.parse(r.finishedAt);
      return Number.isFinite(t) && t >= cutoff && t <= input.now.getTime();
    })
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));

  const lines: ScheduleDigestLine[] = recent.slice(0, limit).map((r) => {
    const status = classify(r.status);
    const goalBit = r.goal?.trim() ? `: ${r.goal.trim().slice(0, 48)}` : "";
    return {
      scheduleId: r.scheduleId,
      scheduleName: r.scheduleName,
      status,
      taskId: r.taskId ?? null,
      summary:
        status === "failed"
          ? `${r.scheduleName} failed${goalBit}`
          : status === "done"
            ? `${r.scheduleName} finished${goalBit}`
            : `${r.scheduleName} (${r.status})${goalBit}`,
    };
  });

  const doneCount = lines.filter((l) => l.status === "done").length;
  const failedCount = lines.filter((l) => l.status === "failed").length;

  let headline = "No scheduled runs overnight";
  if (lines.length > 0) {
    if (failedCount > 0 && doneCount > 0) {
      headline = `${doneCount} scheduled done, ${failedCount} failed overnight`;
    } else if (failedCount > 0) {
      headline =
        failedCount === 1
          ? "1 scheduled run failed overnight"
          : `${failedCount} scheduled runs failed overnight`;
    } else if (doneCount > 0) {
      headline =
        doneCount === 1
          ? "1 scheduled run finished overnight"
          : `${doneCount} scheduled runs finished overnight`;
    } else {
      headline = `${lines.length} scheduled runs overnight`;
    }
  }

  return { lines, doneCount, failedCount, headline };
}

export function shouldShowScheduleDigest(d: ScheduleDigest): boolean {
  return d.lines.length > 0;
}
