import { describe, expect, it } from "vitest";
import {
  isCompactionEvent,
  projectCompactionMarker,
} from "./compaction-marker";

describe("projectCompactionMarker", () => {
  it("maps completed compact to a calm marker and keeps an optional summary", () => {
    const marker = projectCompactionMarker([
      {
        kind: "step",
        payload: {
          title: "auto_compact_started",
        },
      },
      {
        kind: "step",
        payload: {
          title: "compact_completed",
          summary: "Older turns were summarized.",
        },
      },
    ]);
    expect(marker).toEqual({
      phase: "completed",
      summary: "Older turns were summarized.",
    });
  });

  it("ignores unrelated steps", () => {
    expect(
      projectCompactionMarker([
        { kind: "step", payload: { title: "protection" } },
        { kind: "message", payload: { text: "hi" } },
      ]),
    ).toBeNull();
  });

  it("flags compaction events for work-details hiding", () => {
    expect(
      isCompactionEvent({
        kind: "step",
        payload: { title: "auto_compact_failed" },
      }),
    ).toBe(true);
    expect(
      isCompactionEvent({ kind: "step", payload: { title: "session_status" } }),
    ).toBe(false);
  });
});
