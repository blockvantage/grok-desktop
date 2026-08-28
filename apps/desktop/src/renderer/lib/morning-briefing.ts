/**
 * Morning (and any-time) coworker briefing — unfinished work, approvals, schedules.
 * Pure derivation for Home greeting strip; no LLM required.
 */

export type BriefingTask = {
  id: string;
  title?: string | null;
  goal: string;
  status: string;
  updatedAt: string;
};

export type BriefingSchedule = {
  id: string;
  name: string;
  enabled: boolean;
  /** ISO next run if known. */
  nextRunAt?: string | null;
};

export type BriefingInboxItem = {
  id: string;
  kind: string;
  title: string;
  read?: boolean | null;
  taskId?: string | null;
};

function itemTitle(item: BriefingInboxItem): string {
  return item.title ?? "";
}

export type BriefingLine = {
  kind:
    | "needs_you"
    | "failed"
    | "working"
    | "schedule"
    | "suggestion"
    | "overnight_done"
    | "overnight_waiting"
    | "clear";
  text: string;
  taskId?: string;
  scheduleId?: string;
};

export type MorningBriefing = {
  /** Short title for the card. */
  title: string;
  lines: BriefingLine[];
  /** Whether the briefing has actionable content. */
  actionable: boolean;
};

function isMorningHour(hour: number): boolean {
  return hour >= 5 && hour < 12;
}

/**
 * Build a desk briefing from live lists.
 */
export function buildMorningBriefing(input: {
  tasks: BriefingTask[];
  schedules: BriefingSchedule[];
  inbox: BriefingInboxItem[];
  now: Date;
  /** Max bullet lines. */
  limit?: number;
}): MorningBriefing {
  const limit = input.limit ?? 5;
  const lines: BriefingLine[] = [];

  const overnightDone = input.inbox.filter(
    (i) => !i.read && i.kind === "schedule_done",
  );
  for (const item of overnightDone.slice(0, 2)) {
    lines.push({
      kind: "overnight_done",
      text: item.title || "A scheduled run finished overnight",
      taskId: item.taskId ?? undefined,
    });
  }
  const overnightWaiting = input.inbox.filter(
    (i) =>
      !i.read &&
      i.kind === "unfinished" &&
      /scheduled|overnight|night shift/i.test(itemTitle(i)),
  );
  for (const item of overnightWaiting.slice(0, 1)) {
    lines.push({
      kind: "overnight_waiting",
      text: item.title || "A scheduled run needs you",
    });
  }

  const unreadNeeds = input.inbox.filter(
    (i) =>
      !i.read &&
      (i.kind === "approval" ||
        (i.kind === "unfinished" &&
          !/scheduled|overnight|night shift/i.test(itemTitle(i)))),
  );
  for (const item of unreadNeeds.slice(0, 2)) {
    lines.push({
      kind: "needs_you",
      text: item.title || "Something needs your attention",
    });
  }

  const needsYouTasks = input.tasks.filter((t) =>
    ["waiting_approval", "waiting_user"].includes(t.status),
  );
  for (const t of needsYouTasks.slice(0, 2)) {
    if (lines.some((l) => l.taskId === t.id)) continue;
    lines.push({
      kind: "needs_you",
      text: (t.title?.trim() || t.goal.slice(0, 72) || "Task needs you").trim(),
      taskId: t.id,
    });
  }

  // Failed tasks intentionally omitted from Home briefing (retry in Chats).

  const working = input.tasks.filter((t) =>
    ["running", "starting", "streaming"].includes(t.status),
  );
  if (working.length > 0) {
    lines.push({
      kind: "working",
      text:
        working.length === 1
          ? "1 task is still running"
          : `${working.length} tasks are still running`,
      taskId: working[0]!.id,
    });
  }

  const enabled = input.schedules.filter((s) => s.enabled);
  const upcoming = enabled
    .filter((s) => s.nextRunAt)
    .sort((a, b) => (a.nextRunAt! > b.nextRunAt! ? 1 : -1));
  for (const s of upcoming.slice(0, 2)) {
    lines.push({
      kind: "schedule",
      text: `Next: ${s.name}`,
      scheduleId: s.id,
    });
  }
  if (upcoming.length === 0 && enabled.length > 0) {
    lines.push({
      kind: "schedule",
      text:
        enabled.length === 1
          ? "1 automation is armed"
          : `${enabled.length} automations are armed`,
      scheduleId: enabled[0]!.id,
    });
  }

  const trimmed = lines.slice(0, limit);
  const morning = isMorningHour(input.now.getHours());
  const actionable = trimmed.some((l) => l.kind !== "clear");

  if (!actionable) {
    return {
      title: morning ? "You're clear this morning" : "Desk is clear",
      lines: [
        {
          kind: "clear",
          text: morning
            ? "No unfinished work waiting — start a new goal when you're ready."
            : "Nothing needs you right now.",
        },
      ],
      actionable: false,
    };
  }

  return {
    title: morning ? "Your morning desk" : "What's on your desk",
    lines: trimmed,
    actionable: true,
  };
}

/**
 * Single subtitle string suitable for greeting fallback when briefing is compact.
 */
export function briefingSubtitle(briefing: MorningBriefing): string {
  if (!briefing.actionable) return briefing.lines[0]?.text ?? "";
  return briefing.lines
    .slice(0, 2)
    .map((l) => l.text)
    .join(" · ");
}
