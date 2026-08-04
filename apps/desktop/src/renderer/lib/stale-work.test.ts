import { describe, expect, it } from "vitest";
import {
  detectStaleWork,
  formatStaleDuration,
  staleHeadline,
} from "./stale-work";

describe("stale-work", () => {
  const now = new Date("2026-07-15T12:00:00.000Z");

  it("flags long-running tasks with no updates", () => {
    const stale = detectStaleWork(
      [
        {
          id: "a",
          goal: "research",
          status: "running",
          updatedAt: "2026-07-15T10:00:00.000Z", // 2h ago
        },
        {
          id: "b",
          goal: "fresh",
          status: "running",
          updatedAt: "2026-07-15T11:50:00.000Z",
        },
      ],
      now,
      { activeStaleMs: 30 * 60_000 },
    );
    expect(stale.map((s) => s.taskId)).toEqual(["a"]);
    expect(stale[0]!.reason).toBe("no_progress");
    expect(formatStaleDuration(stale[0]!.staleForMs)).toMatch(/h|m/);
    expect(staleHeadline(stale)).toMatch(/stuck/i);
  });

  it("flags long waiting but not a pile of old failures", () => {
    const stale = detectStaleWork(
      [
        {
          id: "w",
          goal: "approve me",
          status: "waiting_approval",
          updatedAt: "2026-07-15T08:00:00.000Z",
        },
        {
          id: "f",
          goal: "old fail",
          status: "failed",
          updatedAt: "2026-07-14T12:00:00.000Z",
        },
      ],
      now,
    );
    expect(stale.map((s) => s.taskId)).toEqual(["w"]);
    expect(staleHeadline(stale)).toMatch(/need/i);
  });
});
