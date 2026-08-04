import type { TaskService } from "./tasks.js";
import type { InboxService } from "./inbox.js";
import type { SettingsService } from "./settings.js";
import type { MemoryService } from "./memory.js";
import type { SchedulerService } from "./scheduler.js";
import {
  isInQuietHours,
  suggestAutomationsFromMemory,
  type AutomationSuggestion,
} from "@grokdesk/shared";

export class ProactivityService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private memory: MemoryService | null = null;
  private scheduler: SchedulerService | null = null;

  constructor(
    private tasks: TaskService,
    private inbox: InboxService,
    private settings: SettingsService,
  ) {}

  /** Optional wiring for memory-aware automation suggestions. */
  setIntelligenceSources(opts: {
    memory?: MemoryService | null;
    scheduler?: SchedulerService | null;
  }): void {
    if (opts.memory !== undefined) this.memory = opts.memory;
    if (opts.scheduler !== undefined) this.scheduler = opts.scheduler;
  }

  start(intervalMs = 60 * 60_000): void {
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

  tick(now: Date = new Date()): number {
    // Retention: drop old read/dismissed inbox rows on every tick.
    this.inbox.prune();
    const quiet = this.settings.getQuietHours();
    if (isInQuietHours(now, quiet)) return 0;
    let n = 0;
    for (const t of this.tasks.list()) {
      if (t.status === "waiting_approval" || t.status === "waiting_user") {
        const item = this.inbox.addDeduped({
          kind: "approval",
          title: "Task needs you",
          body: t.goal.slice(0, 200),
          taskId: t.id,
        });
        if (item) n++;
      }
      if (t.status === "failed") {
        const item = this.inbox.addDeduped({
          kind: "unfinished",
          title: "Task failed",
          body: t.goal.slice(0, 200),
          taskId: t.id,
        });
        if (item) n++;
      }
    }
    n += this.emitAutomationSuggestions();
    return n;
  }

  /**
   * Memory-aware smart automations: turn standing/profile context into
   * suggestion inbox items with draft schedule templates.
   */
  emitAutomationSuggestions(): number {
    if (!this.memory) return 0;
    const memories = this.memory.list();
    const rules = this.scheduler?.list() ?? [];
    const suggestions = suggestAutomationsFromMemory(memories, rules);
    let n = 0;
    for (const s of suggestions) {
      if (this.pushSuggestion(s)) n++;
    }
    return n;
  }

  /** Public for tests: generate suggestions without mutating inbox. */
  previewAutomationSuggestions(): AutomationSuggestion[] {
    if (!this.memory) return [];
    return suggestAutomationsFromMemory(
      this.memory.list(),
      this.scheduler?.list() ?? [],
    );
  }

  private pushSuggestion(s: AutomationSuggestion): boolean {
    // Dedupe via synthetic taskId so addDeduped works across title rewrites.
    const item = this.inbox.addDeduped({
      kind: "suggestion",
      title: s.title,
      body: `${s.body}\n\nDraft schedule: ${s.draftSchedule.name} (${s.draftSchedule.cron})\nGoal: ${s.draftSchedule.goalTemplate}`,
      taskId: `suggestion:${s.suggestionKey}`,
    });
    return item != null;
  }
}
