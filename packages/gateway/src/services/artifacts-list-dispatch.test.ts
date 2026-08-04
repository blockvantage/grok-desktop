import { describe, it, expect, vi } from "vitest";
import { dispatchArtifactsList } from "./artifacts-list-dispatch.js";

describe("dispatchArtifactsList", () => {
  it("harvests when gate says so then lists", () => {
    const harvest = vi.fn(() => 2);
    const list = vi.fn(() => [{ id: "a" }]);
    const out = dispatchArtifactsList(
      { taskId: "t1" },
      {
        getTaskStatus: () => "done",
        harvest,
        list,
      },
    );
    expect(harvest).toHaveBeenCalledWith("t1");
    expect(list).toHaveBeenCalledWith("t1");
    expect(out).toEqual([{ id: "a" }]);
  });

  it("lists all without harvest when no taskId", () => {
    const harvest = vi.fn();
    const list = vi.fn(() => []);
    dispatchArtifactsList(
      {},
      {
        getTaskStatus: () => undefined,
        harvest,
        list,
      },
    );
    expect(harvest).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith(undefined);
  });
});
