import { describe, expect, it } from "vitest";
import {
  decodeMonitorEvent,
  foldWatchUntil,
  watchUntilStopPrompt,
} from "./monitor-event.js";

describe("decodeMonitorEvent", () => {
  it("reads camel and snake MonitorEvent envelopes", () => {
    const view = decodeMonitorEvent({
      sessionUpdate: "MonitorEvent",
      monitor_id: "m1",
      description: "CI green",
      line: "All checks passed",
      status: "completed",
    });
    expect(view).toEqual({
      monitorId: "m1",
      description: "CI green",
      line: "All checks passed",
      status: "done",
    });
  });

  it("never throws on junk", () => {
    expect(decodeMonitorEvent(null)).toBeNull();
    expect(decodeMonitorEvent("nope")).toBeNull();
    expect(decodeMonitorEvent({ title: "goal_update" })).toBeNull();
  });
});

describe("foldWatchUntil", () => {
  it("keeps the last line and latest status", () => {
    const view = foldWatchUntil([
      {
        kind: "step",
        title: "monitor_event",
        payload: {
          title: "monitor_event",
          monitorId: "m1",
          description: "Watch CI",
          line: "queued",
          status: "running",
        },
      },
      {
        kind: "step",
        title: "monitor_event",
        payload: {
          title: "monitor_event",
          monitorId: "m1",
          description: "Watch CI",
          line: "DONE",
          status: "done",
        },
      },
    ]);
    expect(view).toMatchObject({
      monitorId: "m1",
      lastLine: "DONE",
      status: "done",
    });
    expect(watchUntilStopPrompt(view!)).toContain("m1");
  });
});
