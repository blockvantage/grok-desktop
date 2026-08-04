/**
 * Debounced gateway server-push scheduling (Phase 6 extract).
 * Coalesces high-frequency task list / event updates so stdio and remote
 * notify frames do not flood the desktop UI or paired phones.
 */

export interface NotifySchedulerOptions {
  /** Debounce for notify.tasksChanged (default 40ms). */
  tasksChangedMs?: number;
  /** Debounce for notify.taskEvents per task (default 80ms). */
  taskEventMs?: number;
  /** Clock injection for tests. */
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

export type TasksChangedEmit = () => void;
export type TaskEventEmit = (taskId: string, seq: number) => void;

/**
 * Owns coalescing timers for tasksChanged and per-task event notifies.
 * Call clear() on gateway stop so pending timers do not fire after teardown.
 */
export class DebouncedNotifyScheduler {
  private tasksChangedTimer: ReturnType<typeof setTimeout> | null = null;
  private eventNotifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly tasksChangedMs: number;
  private readonly taskEventMs: number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private emitTasksChanged: TasksChangedEmit;
  private emitTaskEvent: TaskEventEmit;

  constructor(
    emitTasksChanged: TasksChangedEmit,
    emitTaskEvent: TaskEventEmit,
    opts: NotifySchedulerOptions = {},
  ) {
    this.emitTasksChanged = emitTasksChanged;
    this.emitTaskEvent = emitTaskEvent;
    this.tasksChangedMs = opts.tasksChangedMs ?? 40;
    this.taskEventMs = opts.taskEventMs ?? 80;
    this.setTimeoutFn = opts.setTimeout ?? setTimeout;
    this.clearTimeoutFn = opts.clearTimeout ?? clearTimeout;
  }

  /** Rebind emit targets (e.g. after Gateway methods are stable). */
  setEmitters(
    emitTasksChanged: TasksChangedEmit,
    emitTaskEvent: TaskEventEmit,
  ): void {
    this.emitTasksChanged = emitTasksChanged;
    this.emitTaskEvent = emitTaskEvent;
  }

  scheduleTasksChanged(): void {
    if (this.tasksChangedTimer) return;
    this.tasksChangedTimer = this.setTimeoutFn(() => {
      this.tasksChangedTimer = null;
      this.emitTasksChanged();
    }, this.tasksChangedMs);
  }

  /**
   * Coalesce task event notifies by taskId. The latest `seq` wins when
   * multiple appends land inside the debounce window.
   */
  scheduleTaskEvent(taskId: string, seq: number): void {
    if (this.eventNotifyTimers.has(taskId)) {
      // Refresh seq for the pending fire by clearing and re-arming with latest seq.
      const prev = this.eventNotifyTimers.get(taskId)!;
      this.clearTimeoutFn(prev);
      this.eventNotifyTimers.delete(taskId);
    }
    this.eventNotifyTimers.set(
      taskId,
      this.setTimeoutFn(() => {
        this.eventNotifyTimers.delete(taskId);
        this.emitTaskEvent(taskId, seq);
      }, this.taskEventMs),
    );
  }

  /** Cancel all pending timers (gateway stop). */
  clear(): void {
    if (this.tasksChangedTimer) {
      this.clearTimeoutFn(this.tasksChangedTimer);
      this.tasksChangedTimer = null;
    }
    for (const t of this.eventNotifyTimers.values()) {
      this.clearTimeoutFn(t);
    }
    this.eventNotifyTimers.clear();
  }

  /** Test helper: pending task event debounce keys. */
  pendingTaskEventIds(): string[] {
    return [...this.eventNotifyTimers.keys()];
  }

  hasPendingTasksChanged(): boolean {
    return this.tasksChangedTimer != null;
  }
}
