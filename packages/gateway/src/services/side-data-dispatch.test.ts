import { describe, it, expect, vi } from "vitest";
import {
  dispatchSideDataMethod,
  isSideDataMethod,
} from "./side-data-dispatch.js";

function baseDeps(
  overrides: Partial<
    import("./side-data-dispatch.js").SideDataDeps
  > = {},
): import("./side-data-dispatch.js").SideDataDeps {
  return {
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
    auditList: vi.fn(() => ({
      entries: [],
      hasMore: false,
      total: 0,
      limit: 100,
      offset: 0,
    })),
    ...overrides,
  };
}

describe("isSideDataMethod", () => {
  it("recognizes schedule/memory/inbox/audit", () => {
    expect(isSideDataMethod("schedule.list")).toBe(true);
    expect(isSideDataMethod("memory.upsert")).toBe(true);
    expect(isSideDataMethod("inbox.dismiss")).toBe(true);
    expect(isSideDataMethod("audit.list")).toBe(true);
    expect(isSideDataMethod("tasks.list")).toBe(false);
  });
});

describe("dispatchSideDataMethod", () => {
  it("lists and creates schedules", () => {
    const scheduleList = vi.fn(() => [{ id: "s1" }]);
    const scheduleCreate = vi.fn((p) => ({ ...p, id: "new" }));
    const deps = baseDeps({ scheduleList, scheduleCreate });
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
    const deps = baseDeps({
      memoryList: vi.fn(() => []),
      memoryUpsert: vi.fn((p) => p),
      memoryDelete,
      inboxList: vi.fn(() => []),
      inboxMarkRead,
    });
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
    const deps = baseDeps({ scheduleDelete });
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
    const deps = baseDeps();
    expect(() =>
      dispatchSideDataMethod("memory.delete", {}, deps),
    ).toThrow(/id required/);
  });

  it("dispatches audit.list with filters", () => {
    const page = {
      entries: [{ id: "a1" }],
      hasMore: false,
      total: 1,
      limit: 20,
      offset: 0,
    };
    const auditList = vi.fn(() => page);
    const deps = baseDeps({ auditList });
    expect(
      dispatchSideDataMethod(
        "audit.list",
        { taskId: "t1", decision: "deny", limit: 20 },
        deps,
      ),
    ).toEqual(page);
    expect(auditList).toHaveBeenCalledWith({
      taskId: "t1",
      decision: "deny",
      limit: 20,
      offset: undefined,
    });
  });

  it("dispatches audit.list with offset for multi-page trails", () => {
    const page = {
      entries: [{ id: "a2" }],
      hasMore: true,
      total: 40,
      limit: 10,
      offset: 10,
    };
    const auditList = vi.fn(() => page);
    const deps = baseDeps({ auditList });
    expect(
      dispatchSideDataMethod(
        "audit.list",
        { taskId: "t1", limit: 10, offset: 10 },
        deps,
      ),
    ).toEqual(page);
    expect(auditList).toHaveBeenCalledWith({
      taskId: "t1",
      decision: undefined,
      limit: 10,
      offset: 10,
    });
  });

  it("normalizes empty/missing audit.list params before deps.auditList", () => {
    const auditList = vi.fn(() => ({
      entries: [],
      hasMore: false,
      total: 0,
      limit: 100,
      offset: 0,
    }));
    const deps = baseDeps({ auditList });

    dispatchSideDataMethod("audit.list", {}, deps);
    expect(auditList).toHaveBeenLastCalledWith({
      taskId: undefined,
      decision: undefined,
      limit: undefined,
      offset: undefined,
    });

    dispatchSideDataMethod(
      "audit.list",
      { taskId: "", decision: "", limit: Number.NaN, offset: Number.NaN },
      deps,
    );
    expect(auditList).toHaveBeenLastCalledWith({
      taskId: undefined,
      decision: undefined,
      limit: undefined,
      offset: undefined,
    });

    dispatchSideDataMethod(
      "audit.list",
      { taskId: "t2", decision: "allow", limit: Number.POSITIVE_INFINITY },
      deps,
    );
    expect(auditList).toHaveBeenLastCalledWith({
      taskId: "t2",
      decision: "allow",
      limit: undefined,
      offset: undefined,
    });
  });

  it("fails closed on invalid non-empty audit.list decision (no unfiltered trail)", () => {
    const auditList = vi.fn(() => ({
      entries: [],
      hasMore: false,
      total: 0,
      limit: 100,
      offset: 0,
    }));
    const deps = baseDeps({ auditList });
    expect(() =>
      dispatchSideDataMethod(
        "audit.list",
        { decision: "not-a-decision" },
        deps,
      ),
    ).toThrow(/invalid audit decision filter/);
    expect(auditList).not.toHaveBeenCalled();

    expect(() =>
      dispatchSideDataMethod("audit.list", { decision: "maybe" }, deps),
    ).toThrow(/invalid audit decision filter/);
    expect(auditList).not.toHaveBeenCalled();
  });

  it("fails closed on non-string decision (does not silently drop filter)", () => {
    const auditList = vi.fn(() => ({
      entries: [],
      hasMore: false,
      total: 0,
      limit: 100,
      offset: 0,
    }));
    const deps = baseDeps({ auditList });
    expect(() =>
      dispatchSideDataMethod(
        "audit.list",
        { decision: 42 } as Record<string, unknown>,
        deps,
      ),
    ).toThrow(/expected string/);
    expect(auditList).not.toHaveBeenCalled();

    expect(() =>
      dispatchSideDataMethod(
        "audit.list",
        { decision: { ok: true } } as Record<string, unknown>,
        deps,
      ),
    ).toThrow(/expected string/);
    expect(auditList).not.toHaveBeenCalled();
  });
});
