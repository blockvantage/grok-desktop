import { describe, it, expect } from "vitest";
import { dualSearchValue, topbarSearchValue } from "./dual-search";

describe("dualSearchValue", () => {
  it("mirrors topbar query into tasks-scoped cache (not a second input)", () => {
    expect(dualSearchValue("foo")).toEqual({
      search: "foo",
      taskSearch: "foo",
    });
  });
});

describe("topbarSearchValue", () => {
  it("prefers taskSearch on tasks nav (single topbar field)", () => {
    expect(
      topbarSearchValue({
        nav: "tasks",
        search: "a",
        taskSearch: "b",
      }),
    ).toBe("b");
    expect(
      topbarSearchValue({
        nav: "tasks",
        search: "a",
        taskSearch: "",
      }),
    ).toBe("a");
  });

  it("uses global search off tasks (artifacts/memory share one field)", () => {
    expect(
      topbarSearchValue({
        nav: "artifacts",
        search: "report",
        taskSearch: "old-task-q",
      }),
    ).toBe("report");
    expect(
      topbarSearchValue({
        nav: "home",
        search: "a",
        taskSearch: "b",
      }),
    ).toBe("a");
  });
});
