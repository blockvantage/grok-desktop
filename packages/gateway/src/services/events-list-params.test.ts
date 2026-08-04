import { describe, it, expect } from "vitest";
import { eventsListParams } from "./events-list-params.js";

describe("eventsListParams", () => {
  it("defaults afterSeq to 0", () => {
    expect(eventsListParams({ taskId: "t1" })).toEqual({
      taskId: "t1",
      afterSeq: 0,
    });
  });

  it("parses numeric afterSeq", () => {
    expect(eventsListParams({ taskId: "t1", afterSeq: 12 })).toEqual({
      taskId: "t1",
      afterSeq: 12,
    });
    expect(eventsListParams({ taskId: "t1", afterSeq: "3" })).toEqual({
      taskId: "t1",
      afterSeq: 3,
    });
  });
});
