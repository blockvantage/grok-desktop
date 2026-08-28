import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ApprovalMode, EffortLevel, ScheduleRule } from "@grokdesk/shared";
import { isInQuietHours, nextRunAt, normalizeRoot } from "@grokdesk/shared";
import type { Db } from "../db.js";
import type { TaskService } from "./tasks.js";
import type { SettingsService } from "./settings.js";
import { ScheduleOccurrenceService } from "./schedule-occurrences.js";
import type { TaskSubmissionService } from "./task-submission.js";
import { desktopRequestContext } from "./request-context.js";
import type { EntitlementGuard } from "./entitlement-guard.js";
import { isEntitlementReadOnlyError } from "./entitlement-error.js";
import { requireGrokAdmissionSync } from "./entitlement-admission.js";

export type OnScheduledTasksCreated = (
  taskIds: string[],
) => void | Promise<void>;

export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFired = new Map<string, number>();
  private onTasksCreated: OnScheduledTasksCreated | null = null;
  private occurrences: ScheduleOccurrenceService;
  /** One submission path for scheduled work (run attempts + correlation). */
  private submission: TaskSubmissionService | null = null;
  /** Optional Grok admission guard — schedule editing remains allowed without it. */
  private entitlementGuard: EntitlementGuard | null = null;
  /**
   * When true, skip occurrence *dispatch* (sleep/suspend). Tracking of due
   * times continues so missed-run policy still applies after wake.
   */
  private dispatchPaused = false;

  constructor(
    private db: Db,
    private tasks: TaskService,
    private settings: SettingsService,
    /** Where folderless scheduled runs get their private workspace. */
    private workspacesDir: string = path.join(os.tmpdir(), "grokdesk-workspaces"),
  ) {
    this.occurrences = new ScheduleOccurrenceService(db);
  }

  /** Wire TaskRunner.pumpQueue (or equivalent) so scheduled tasks actually start. */
  setOnTasksCreated(cb: OnScheduledTasksCreated | null): void {
    this.onTasksCreated = cb;
  }

  /**
   * Prefer TaskSubmissionService so scheduled runs get durable run attempts
   * and correlation (TASK-03 / one submission path).
   */
  setTaskSubmission(svc: TaskSubmissionService | null): void {
    this.submission = svc;
  }

  /**
   * Guard schedule *execution* (tick). Creating/editing rules is local_manage
   * and stays available when the lease is expired.
   */
  setEntitlementGuard(guard: EntitlementGuard | null): void {
    this.entitlementGuard = guard;
  }

  /** Private workspace for a folderless scheduled run, under the app data dir. */
  private ensureScheduledWorkspace(): string {
    fs.mkdirSync(this.workspacesDir, { recursive: true });
    return fs.mkdtempSync(path.join(this.workspacesDir, "grok-scheduled-"));
  }

  start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Pause scheduled task creation (power suspend). Occurrence tracking continues. */
  pause(): void {
    this.dispatchPaused = true;
  }

  /** Resume scheduled task creation after wake + auth refresh. */
  resume(): void {
    this.dispatchPaused = false;
  }

  isDispatchPaused(): boolean {
    return this.dispatchPaused;
  }

  /** Test helper: clear debounce state so a due rule can fire again. */
  resetFireState(): void {
    this.lastFired.clear();
  }

  list(limit = 200): ScheduleRule[] {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 1_000);
    const rows = this.db
      .prepare(
        `SELECT * FROM schedule_rules ORDER BY created_at DESC LIMIT ?`,
      )
      .all(lim) as Record<string, unknown>[];
    return rows.map(rowToRule);
  }

  create(input: {
    name: string;
    goalTemplate: string;
    cron: string;
    timezone: string;
    approvalMode?: ApprovalMode;
    model?: string;
    effort?: EffortLevel;
    workspaceRoots: string[];
    rolePack?: string | null;
    quietHoursRespect?: boolean;
  }): ScheduleRule {
    // Fail closed at create — invalid cron/tz used to be stored then silently
    // skipped every tick, which looks like a broken schedule UI.
    try {
      nextRunAt(input.cron, input.timezone);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid schedule cron or timezone: ${msg}`);
    }
    if (!input.workspaceRoots?.length) {
      throw new Error("Schedule requires at least one workspace root");
    }
    // Absolute normalized roots only — refuse relative paths that resolve
    // against the gateway process cwd unpredictably.
    const workspaceRoots = input.workspaceRoots.map((r) => {
      const trimmed = r.trim();
      if (!path.isAbsolute(trimmed)) {
        throw new Error(`Schedule workspace root must be absolute: ${r}`);
      }
      return normalizeRoot(path.resolve(trimmed));
    });
    const now = new Date().toISOString();
    const rule: ScheduleRule = {
      id: randomUUID(),
      name: input.name,
      goalTemplate: input.goalTemplate,
      cron: input.cron,
      timezone: input.timezone,
      enabled: true,
      quietHoursRespect: input.quietHoursRespect ?? true,
      approvalMode: input.approvalMode ?? "balanced",
      model: input.model ?? "grok-4.5",
      effort: input.effort ?? "normal",
      workspaceRoots,
      rolePack: input.rolePack ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO schedule_rules (
          id, name, goal_template, cron, timezone, enabled, quiet_hours_respect,
          approval_mode, model, effort, workspace_roots_json, role_pack, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rule.id,
        rule.name,
        rule.goalTemplate,
        rule.cron,
        rule.timezone,
        rule.quietHoursRespect ? 1 : 0,
        rule.approvalMode,
        rule.model,
        rule.effort,
        JSON.stringify(rule.workspaceRoots),
        rule.rolePack,
        rule.createdAt,
        rule.updatedAt,
      );
    return rule;
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare(
        `UPDATE schedule_rules SET enabled = ?, updated_at = ? WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, new Date().toISOString(), id);
  }

  /**
   * Remove a rule permanently. Past occurrences are left for history and are
   * swept by ScheduleOccurrenceService.prune; tick() already drops debounce
   * entries for ids no longer in the live rule set.
   */
  delete(id: string): void {
    this.db.prepare(`DELETE FROM schedule_rules WHERE id = ?`).run(id);
  }

  get(id: string): ScheduleRule | null {
    const row = this.db
      .prepare(`SELECT * FROM schedule_rules WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToRule(row) : null;
  }

  /**
   * Upsert an engine-created scheduled task into Desk's scheduler of record.
   * Uses a stable id so Created/Deleted reconcile without a schema bump.
   */
  upsertEngineRule(input: {
    id: string;
    name: string;
    goalTemplate: string;
    cron: string;
    timezone?: string;
  }): ScheduleRule {
    try {
      nextRunAt(input.cron, input.timezone ?? "UTC");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid schedule cron or timezone: ${msg}`);
    }
    const existing = this.get(input.id);
    const now = new Date().toISOString();
    const timezone = input.timezone ?? existing?.timezone ?? "UTC";
    const workspaceRoots =
      existing?.workspaceRoots?.length
        ? existing.workspaceRoots
        : [this.ensureScheduledWorkspace()];
    if (existing) {
      this.db
        .prepare(
          `UPDATE schedule_rules
           SET name = ?, goal_template = ?, cron = ?, timezone = ?, enabled = 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.name,
          input.goalTemplate,
          input.cron,
          timezone,
          now,
          input.id,
        );
      return this.get(input.id)!;
    }
    const rule: ScheduleRule = {
      id: input.id,
      name: input.name,
      goalTemplate: input.goalTemplate,
      cron: input.cron,
      timezone,
      enabled: true,
      quietHoursRespect: true,
      approvalMode: "balanced",
      model: "grok-4.5",
      effort: "normal",
      workspaceRoots,
      rolePack: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO schedule_rules (
          id, name, goal_template, cron, timezone, enabled, quiet_hours_respect,
          approval_mode, model, effort, workspace_roots_json, role_pack, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rule.id,
        rule.name,
        rule.goalTemplate,
        rule.cron,
        rule.timezone,
        rule.approvalMode,
        rule.model,
        rule.effort,
        JSON.stringify(rule.workspaceRoots),
        rule.rolePack,
        rule.createdAt,
        rule.updatedAt,
      );
    return rule;
  }

  /**
   * Evaluate schedules; returns task ids created.
   * Invokes onTasksCreated (wired to runner.pumpQueue) so work actually starts.
   *
   * Entitlement is checked *before* occurrence creation so an expired lease
   * does not consume the durable (scheduleId, scheduledFor) key — the rule
   * can fire once entitlement recovers.
   */
  tick(now: Date = new Date()): string[] {
    const quiet = this.settings.getQuietHours();
    const created: string[] = [];

    // Sleep/suspend: skip dispatch only. Timer keeps running; due rules fire on wake.
    if (this.dispatchPaused) {
      return created;
    }

    // One admission check per tick. Production fail-closed denies when
    // guard is missing under GROKDESK_ENTITLEMENT_FAIL_CLOSED=1.
    try {
      requireGrokAdmissionSync(this.entitlementGuard, "scheduled");
    } catch (e) {
      if (isEntitlementReadOnlyError(e)) {
        return created;
      }
      throw e;
    }

    const rules = this.list();
    // Drop debounce entries for deleted rules so lastFired cannot grow forever.
    if (this.lastFired.size > 0) {
      const live = new Set(rules.map((r) => r.id));
      for (const id of this.lastFired.keys()) {
        if (!live.has(id)) this.lastFired.delete(id);
      }
    }

    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (rule.quietHoursRespect && isInQuietHours(now, quiet)) continue;

      const last = this.lastFired.get(rule.id) ?? 0;
      // Min gap between fires for the same rule
      if (last > 0 && now.getTime() - last < 30_000) continue;

      let next: Date;
      try {
        // From just after last fire, or 2 minutes before now on first run
        const from =
          last > 0
            ? new Date(last + 1_000)
            : new Date(now.getTime() - 120_000);
        next = nextRunAt(rule.cron, rule.timezone, from);
      } catch {
        continue;
      }

      if (next.getTime() > now.getTime()) continue; // not due yet

      // Durable exactly-once key: (scheduleId, scheduledFor).
      // tryBegin inserts a pending row, or reclaims a prior 'failed' row up
      // to MAX_SCHEDULE_OCCURRENCE_ATTEMPTS. Returns null when already fired
      // or retries are exhausted — never double-fires a successful run.
      const occ = this.occurrences.tryBegin(rule.id, next);
      if (!occ) {
        // Terminal for this scheduledFor (fired or permanently failed).
        // Advance debounce so we move on to the next cron slot.
        this.lastFired.set(rule.id, now.getTime());
        continue;
      }

      const roots =
        rule.workspaceRoots.length > 0
          ? rule.workspaceRoots
          : [this.ensureScheduledWorkspace()];
      try {
        const input = {
          goal: rule.goalTemplate,
          mode: "scheduled" as const,
          model: rule.model,
          effort: rule.effort,
          workspaceRoots: roots,
          approvalMode: rule.approvalMode,
          rolePack: rule.rolePack,
          scheduleRuleId: rule.id,
        };
        const task = this.submission
          ? this.submission.submit(
              input,
              desktopRequestContext(
                `sched-${rule.id}-${occ.id}`,
              ),
            ).task
          : this.tasks.create(input);
        this.occurrences.markFired(occ.id, task.id);
        this.lastFired.set(rule.id, now.getTime());
        created.push(task.id);
      } catch (e) {
        // Leave lastFired unset so a later tick can reclaim a 'failed' row
        // (bounded by tryBegin). Exhausted failures surface as status=failed.
        this.occurrences.markFailed(
          occ.id,
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    if (created.length > 0 && this.onTasksCreated) {
      void Promise.resolve(this.onTasksCreated(created));
    }
    return created;
  }
}

function rowToRule(r: Record<string, unknown>): ScheduleRule {
  let workspaceRoots: string[] = [];
  try {
    const parsed = JSON.parse(String(r.workspace_roots_json ?? "[]")) as unknown;
    if (Array.isArray(parsed)) {
      workspaceRoots = parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    workspaceRoots = [];
  }
  return {
    id: r.id as string,
    name: r.name as string,
    goalTemplate: r.goal_template as string,
    cron: r.cron as string,
    timezone: r.timezone as string,
    enabled: Boolean(r.enabled),
    quietHoursRespect: Boolean(r.quiet_hours_respect),
    approvalMode: r.approval_mode as ApprovalMode,
    model: r.model as string,
    effort: r.effort as EffortLevel,
    workspaceRoots,
    rolePack: (r.role_pack as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}
