/**
 * Multi-task work board — rank concurrent runs so users can juggle workstreams.
 * Needs-you first, then live work, then recently finished. No second app metaphor.
 */

export type WorkBoardStatus =
  | "needs_you"
  | "working"
  | "queued"
  | "done"
  | "failed"
  | "cancelled"
  | "other";

export type WorkBoardItem = {
  taskId: string;
  title: string;
  goal: string;
  status: WorkBoardStatus;
  rawStatus: string;
  updatedAt: string;
  /** Optional progress 0–1 when known. */
  progress: number | null;
  /** Short human activity line. */
  activity: string | null;
  urgency: number;
};

export type WorkBoardSnapshot = {
  items: WorkBoardItem[];
  needsYouCount: number;
  workingCount: number;
  failedCount: number;
  /** One-line desk summary for Home strip. */
  headline: string;
};

const NEEDS_YOU = new Set(["waiting_approval", "waiting_user"]);
const WORKING = new Set(["running", "starting", "streaming"]);
const QUEUED = new Set(["queued", "pending"]);

export function classifyWorkStatus(raw: string): WorkBoardStatus {
  const s = (raw || "").toLowerCase();
  if (NEEDS_YOU.has(s)) return "needs_you";
  if (WORKING.has(s)) return "working";
  if (QUEUED.has(s)) return "queued";
  if (s === "done" || s === "completed" || s === "succeeded") return "done";
  if (s === "failed" || s === "error") return "failed";
  if (s === "cancelled" || s === "canceled" || s === "interrupted") {
    return "cancelled";
  }
  return "other";
}

/** Higher urgency sorts first. */
export function urgencyForStatus(status: WorkBoardStatus): number {
  switch (status) {
    case "needs_you":
      return 100;
    case "failed":
      return 80;
    case "working":
      return 60;
    case "queued":
      return 40;
    case "cancelled":
      return 20;
    case "done":
      return 10;
    default:
      return 5;
  }
}

export type WorkBoardTaskInput = {
  id: string;
  title?: string | null;
  goal: string;
  status: string;
  updatedAt: string;
  progress?: number | null;
  activity?: string | null;
};

/**
 * Build a ranked concurrent-work board from flat tasks (typically latest turn per chat).
 */
export function buildWorkBoard(
  tasks: WorkBoardTaskInput[],
  opts?: { limit?: number; now?: Date },
): WorkBoardSnapshot {
  const limit = opts?.limit ?? 12;
  const items: WorkBoardItem[] = tasks.map((t) => {
    const status = classifyWorkStatus(t.status);
    return {
      taskId: t.id,
      title: (t.title?.trim() || t.goal.slice(0, 64) || "Untitled").trim(),
      goal: t.goal,
      status,
      rawStatus: t.status,
      updatedAt: t.updatedAt,
      progress:
        typeof t.progress === "number" && Number.isFinite(t.progress)
          ? Math.min(1, Math.max(0, t.progress))
          : null,
      activity: t.activity?.trim() || null,
      urgency: urgencyForStatus(status),
    };
  });

  items.sort((a, b) => {
    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const ranked = items.slice(0, limit);
  const needsYouCount = items.filter((i) => i.status === "needs_you").length;
  const workingCount = items.filter((i) => i.status === "working").length;
  const failedCount = items.filter((i) => i.status === "failed").length;

  return {
    items: ranked,
    needsYouCount,
    workingCount,
    failedCount,
    headline: workBoardHeadline({
      needsYouCount,
      workingCount,
      failedCount,
      total: items.length,
    }),
  };
}

export function workBoardHeadline(input: {
  needsYouCount: number;
  workingCount: number;
  failedCount: number;
  total: number;
}): string {
  if (input.needsYouCount > 0) {
    return input.needsYouCount === 1
      ? "1 task needs you"
      : `${input.needsYouCount} tasks need you`;
  }
  if (input.failedCount > 0) {
    return input.failedCount === 1
      ? "1 task failed — ready to retry"
      : `${input.failedCount} tasks failed — ready to retry`;
  }
  if (input.workingCount > 0) {
    return input.workingCount === 1
      ? "1 task is working"
      : `${input.workingCount} tasks are working`;
  }
  if (input.total === 0) return "No active work — start a goal";
  return "Desk is clear";
}

/**
 * Whether a full live board belongs on Home.
 * Failed-only desks use a one-line summary elsewhere — never a failed wall.
 */
export function shouldShowWorkBoard(board: WorkBoardSnapshot): boolean {
  return board.needsYouCount > 0 || board.workingCount > 0;
}

/** Items safe to list on Home (excludes failed / done piles). */
export function liveWorkBoardItems(
  board: WorkBoardSnapshot,
  limit = 3,
): WorkBoardItem[] {
  return board.items
    .filter((i) => i.status === "needs_you" || i.status === "working")
    .slice(0, limit);
}
