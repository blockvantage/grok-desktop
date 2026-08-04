import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DebouncedNotifyScheduler } from "./notify-scheduler.js";

describe("DebouncedNotifyScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces multiple tasksChanged into one emit", () => {
    const changed = vi.fn();
    const events = vi.fn();
    const s = new DebouncedNotifyScheduler(changed, events, {
      tasksChangedMs: 40,
      taskEventMs: 80,
    });
    s.scheduleTasksChanged();
    s.scheduleTasksChanged();
    s.scheduleTasksChanged();
    expect(changed).not.toHaveBeenCalled();
    expect(s.hasPendingTasksChanged()).toBe(true);
    vi.advanceTimersByTime(40);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(s.hasPendingTasksChanged()).toBe(false);
  });

  it("emits latest seq for task event after debounce", () => {
    const changed = vi.fn();
    const events = vi.fn();
    const s = new DebouncedNotifyScheduler(changed, events, {
      tasksChangedMs: 40,
      taskEventMs: 80,
    });
    s.scheduleTaskEvent("t1", 1);
    s.scheduleTaskEvent("t1", 2);
    s.scheduleTaskEvent("t1", 5);
    vi.advanceTimersByTime(80);
    expect(events).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledWith("t1", 5);
  });

  it("keeps separate debounce windows per taskId", () => {
    const events = vi.fn();
    const s = new DebouncedNotifyScheduler(() => {}, events, {
      taskEventMs: 80,
    });
    s.scheduleTaskEvent("a", 1);
    s.scheduleTaskEvent("b", 2);
    expect(s.pendingTaskEventIds().sort()).toEqual(["a", "b"]);
    vi.advanceTimersByTime(80);
    expect(events).toHaveBeenCalledTimes(2);
    expect(events).toHaveBeenCalledWith("a", 1);
    expect(events).toHaveBeenCalledWith("b", 2);
  });

  it("clear cancels pending emits", () => {
    const changed = vi.fn();
    const events = vi.fn();
    const s = new DebouncedNotifyScheduler(changed, events, {
      tasksChangedMs: 40,
      taskEventMs: 80,
    });
    s.scheduleTasksChanged();
    s.scheduleTaskEvent("t1", 9);
    s.clear();
    vi.advanceTimersByTime(200);
    expect(changed).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
    expect(s.hasPendingTasksChanged()).toBe(false);
    expect(s.pendingTaskEventIds()).toEqual([]);
  });
});
