import { describe, it, expect, vi } from "vitest";
import {
  dispatchSideDataMethod,
  isSideDataMethod,
} from "./side-data-dispatch.js";

describe("isSideDataMethod", () => {
  it("recognizes schedule/memory/inbox", () => {
    expect(isSideDataMethod("schedule.list")).toBe(true);
    expect(isSideDataMethod("memory.upsert")).toBe(true);
    expect(isSideDataMethod("inbox.dismiss")).toBe(true);
    expect(isSideDataMethod("tasks.list")).toBe(false);
  });
});

describe("dispatchSideDataMethod", () => {
  it("lists and creates schedules", () => {
    const scheduleList = vi.fn(() => [{ id: "s1" }]);
    const scheduleCreate = vi.fn((p) => ({ ...p, id: "new" }));
    const deps = {
      scheduleList,
      scheduleCreate,
      scheduleSetEnabled: vi.fn(),
      scheduleDelete: vi.fn(),
      memoryList: vi.fn(),
      memoryUpsert: vi.fn(),
      memoryDelete: vi.fn(),
      inboxList: vi.fn(),
      inboxMarkRead: vi.fn(),
      inboxDismiss: vi.fn(),
    };
    expect(dispatchSideDataMethod("schedule.list", {}, deps)).toEqual([
      { id: "s1" },
    ]);
    expect(
      dispatchSideDataMethod(
        "schedule.create",
        { name: "Daily" },
        deps,
      ),
    ).toEqual({ name: "Daily", id: "new" });
    expect(
      dispatchSideDataMethod(
        "schedule.setEnabled",
        { id: "s1", enabled: true },
        deps,
      ),
    ).toEqual({ ok: true });
    expect(deps.scheduleSetEnabled).toHaveBeenCalledWith("s1", true);
  });

  it("memory + inbox mutations", () => {
    const memoryDelete = vi.fn();
    const inboxMarkRead = vi.fn();
    const deps = {
      scheduleList: vi.fn(),
      scheduleCreate: vi.fn(),
      scheduleSetEnabled: vi.fn(),
      scheduleDelete: vi.fn(),
      memoryList: vi.fn(() => []),
      memoryUpsert: vi.fn((p) => p),
      memoryDelete,
      inboxList: vi.fn(() => []),
      inboxMarkRead,
      inboxDismiss: vi.fn(),
    };
    expect(
      dispatchSideDataMethod("memory.list", { kind: "episodic" }, deps),
    ).toEqual([]);
    expect(
      dispatchSideDataMethod(
        "memory.upsert",
        { title: "t", content: "c" },
        deps,
      ),
    ).toEqual({ title: "t", content: "c" });
    expect(
      dispatchSideDataMethod("memory.delete", { id: "m1" }, deps),
    ).toEqual({ ok: true });
    expect(memoryDelete).toHaveBeenCalledWith("m1");
    expect(
      dispatchSideDataMethod("inbox.markRead", { id: "i1" }, deps),
    ).toEqual({ ok: true });
    expect(inboxMarkRead).toHaveBeenCalledWith("i1");
  });

  it("dispatches schedule.delete", () => {
    const scheduleDelete = vi.fn();
    const deps = {
      scheduleList: vi.fn(),
      scheduleCreate: vi.fn(),
      scheduleSetEnabled: vi.fn(),
      scheduleDelete,
      memoryList: vi.fn(),
      memoryUpsert: vi.fn(),
      memoryDelete: vi.fn(),
      inboxList: vi.fn(),
      inboxMarkRead: vi.fn(),
      inboxDismiss: vi.fn(),
    };
    expect(isSideDataMethod("schedule.delete")).toBe(true);
    expect(
      dispatchSideDataMethod("schedule.delete", { id: "s1" }, deps),
    ).toEqual({ ok: true });
    expect(scheduleDelete).toHaveBeenCalledWith("s1");
    expect(() =>
      dispatchSideDataMethod("schedule.delete", {}, deps),
    ).toThrow(/id required/);
  });

  it("rejects missing ids", () => {
    const deps = {
      scheduleList: vi.fn(),
      scheduleCreate: vi.fn(),
      scheduleSetEnabled: vi.fn(),
      scheduleDelete: vi.fn(),
      memoryList: vi.fn(),
      memoryUpsert: vi.fn(),
      memoryDelete: vi.fn(),
      inboxList: vi.fn(),
      inboxMarkRead: vi.fn(),
      inboxDismiss: vi.fn(),
    };
    expect(() =>
      dispatchSideDataMethod("memory.delete", {}, deps),
    ).toThrow(/id required/);
  });
});
