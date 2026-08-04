import { describe, expect, it } from "vitest";
import {
  isHomeRecentClutterStatus,
  recentTasksForHomeDesk,
} from "./home-recent-tasks";

describe("recentTasksForHomeDesk", () => {
  it("excludes failed and cancelled from the Home recent strip", () => {
    const tasks = [
      { id: "1", status: "failed" },
      { id: "2", status: "done" },
      { id: "3", status: "cancelled" },
      { id: "4", status: "running" },
    ];
    expect(recentTasksForHomeDesk(tasks).map((t) => t.id)).toEqual([
      "2",
      "4",
    ]);
  });

  it("returns empty when only clutter exists so Home can hide the section", () => {
    expect(
      recentTasksForHomeDesk([
        { id: "1", status: "failed" },
        { id: "2", status: "cancelled" },
      ]),
    ).toEqual([]);
  });

  it("caps at three recommended rows", () => {
    const tasks = [
      { id: "a", status: "done" },
      { id: "b", status: "done" },
      { id: "c", status: "done" },
      { id: "d", status: "done" },
    ];
    expect(recentTasksForHomeDesk(tasks, 3)).toHaveLength(3);
  });

  it("classifies clutter statuses", () => {
    expect(isHomeRecentClutterStatus("failed")).toBe(true);
    expect(isHomeRecentClutterStatus("done")).toBe(false);
  });
});
