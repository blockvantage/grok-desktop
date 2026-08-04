import { describe, expect, it } from "vitest";
import {
  rankRecentDeliverables,
  shouldShowRecentDeliverables,
} from "./recent-deliverables";

describe("recent-deliverables", () => {
  it("ranks newest first and titles from path", () => {
    const rows = rankRecentDeliverables(
      [
        {
          id: "1",
          path: "/a/old.md",
          createdAt: "2026-07-14T00:00:00.000Z",
        },
        {
          id: "2",
          title: "Brief",
          path: "/a/brief.md",
          createdAt: "2026-07-15T00:00:00.000Z",
          taskId: "t1",
        },
      ],
      5,
    );
    expect(rows[0]!.id).toBe("2");
    expect(rows[0]!.title).toBe("Brief");
    expect(rows[1]!.title).toBe("old.md");
    expect(shouldShowRecentDeliverables(rows)).toBe(true);
  });

  it("hides empty", () => {
    expect(shouldShowRecentDeliverables([])).toBe(false);
  });
});
