import { describe, it, expect } from "vitest";
import { threadTasksForWorkspace } from "./thread-tasks";

describe("threadTasksForWorkspace", () => {
  it("includes turns and concurrent children of root or turns", () => {
    const root = { id: "root", parentTaskId: null };
    const turn2 = { id: "t2", parentTaskId: "root" };
    const child = { id: "c1", parentTaskId: "root" };
    const nested = { id: "c2", parentTaskId: "t2" };
    const other = { id: "x", parentTaskId: "elsewhere" };
    const all = [root, turn2, child, nested, other];
    const result = threadTasksForWorkspace({
      rootId: "root",
      turns: [root, turn2],
      allTasks: all,
    });
    expect(result.map((t) => t.id)).toEqual(["root", "t2", "c1", "c2"]);
  });

  it("does not duplicate turn members", () => {
    const t = { id: "a", parentTaskId: null as string | null };
    expect(
      threadTasksForWorkspace({
        rootId: "a",
        turns: [t],
        allTasks: [t],
      }),
    ).toEqual([t]);
  });
});
