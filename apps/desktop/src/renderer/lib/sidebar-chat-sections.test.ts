import { describe, expect, it } from "vitest";
import {
  collapseDuplicateTitles,
  isNeedsReviewStatus,
  normalizeSidebarTitle,
  partitionFolderChats,
  partitionSidebarChats,
  prioritizePrimaryChats,
  SIDEBAR_MAX_NEEDS_REVIEW,
  SIDEBAR_MAX_PRIMARY,
} from "./sidebar-chat-sections";

function chat(
  id: string,
  status: string,
  updatedAt = "2026-07-31T12:00:00.000Z",
  pinned = false,
  title = id,
) {
  return { id, updatedAt, latest: { status }, pinned, title };
}

describe("isNeedsReviewStatus", () => {
  it("flags failed and cancelled only", () => {
    expect(isNeedsReviewStatus("failed")).toBe(true);
    expect(isNeedsReviewStatus("cancelled")).toBe(true);
    expect(isNeedsReviewStatus("done")).toBe(false);
    expect(isNeedsReviewStatus("running")).toBe(false);
    expect(isNeedsReviewStatus("waiting_approval")).toBe(false);
  });
});

describe("normalizeSidebarTitle", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeSidebarTitle("  Research  Plan  ")).toBe("research plan");
    expect(normalizeSidebarTitle("Brief…")).toBe("brief");
    expect(normalizeSidebarTitle(undefined)).toBe("");
  });
});

describe("collapseDuplicateTitles", () => {
  it("keeps most recent per title and never drops active/pinned", () => {
    const chats = [
      chat("live", "running", "2026-07-31T15:00:00.000Z", false, "Same goal"),
      chat("new", "done", "2026-07-31T14:00:00.000Z", false, "Same goal"),
      chat("old", "done", "2026-07-31T13:00:00.000Z", false, "Same goal"),
      chat("pin", "failed", "2026-07-31T12:00:00.000Z", true, "Same goal"),
      chat("other", "done", "2026-07-31T11:00:00.000Z", false, "Different"),
    ];
    const collapsed = collapseDuplicateTitles(chats);
    expect(collapsed.map((c) => c.id)).toEqual(["live", "pin", "other"]);
  });

  it("does not collapse empty titles together", () => {
    const collapsed = collapseDuplicateTitles([
      chat("a", "done", "2026-07-31T12:00:00.000Z", false, ""),
      chat("b", "done", "2026-07-31T11:00:00.000Z", false, ""),
    ]);
    expect(collapsed.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("prioritizePrimaryChats", () => {
  it("puts active and pinned ahead of recent done work", () => {
    const chats = [
      chat("done-new", "done", "2026-07-31T16:00:00.000Z"),
      chat("run", "running", "2026-07-31T10:00:00.000Z"),
      chat("done-old", "done", "2026-07-31T09:00:00.000Z"),
      chat("pin", "done", "2026-07-31T08:00:00.000Z", true),
    ];
    expect(prioritizePrimaryChats(chats).map((c) => c.id)).toEqual([
      "run",
      "pin",
      "done-new",
      "done-old",
    ]);
  });
});

describe("partitionSidebarChats", () => {
  it("keeps active and done work in primary; failed history under needs review", () => {
    const chats = [
      chat("a", "running"),
      chat("b", "failed"),
      chat("c", "done"),
      chat("d", "cancelled"),
      chat("e", "waiting_user"),
    ];
    const { primary, needsReview } = partitionSidebarChats(chats);
    // Active statuses (running, waiting_user) sort above done.
    expect(primary.map((c) => c.id)).toEqual(["a", "e", "c"]);
    expect(needsReview.map((c) => c.id)).toEqual(["b", "d"]);
  });

  it("keeps pinned failed chats in primary", () => {
    const { primary, needsReview } = partitionSidebarChats([
      chat("p", "failed", "2026-07-31T12:00:00.000Z", true),
      chat("f", "failed"),
    ]);
    expect(primary.map((c) => c.id)).toEqual(["p"]);
    expect(needsReview.map((c) => c.id)).toEqual(["f"]);
  });

  it("does not let failed history dominate when mixed", () => {
    const manyFailed = Array.from({ length: 12 }, (_, i) =>
      chat(
        `f${i}`,
        "failed",
        `2026-07-30T0${i % 10}:00:00.000Z`,
        false,
        `Fail ${i}`,
      ),
    );
    const chats = [chat("live", "running"), chat("ok", "done"), ...manyFailed];
    const { primary, needsReview } = partitionSidebarChats(chats);
    expect(primary.some((c) => c.id === "live")).toBe(true);
    expect(primary.some((c) => c.id === "ok")).toBe(true);
    expect(needsReview).toHaveLength(12);
    expect(primary.every((c) => c.latest.status !== "failed")).toBe(true);
  });

  it("prioritizes active work above recent done in primary", () => {
    const chats = [
      chat("recent-done", "done", "2026-07-31T18:00:00.000Z"),
      chat("older-run", "running", "2026-07-31T10:00:00.000Z"),
      chat("failed", "failed", "2026-07-31T17:00:00.000Z"),
    ];
    const { primary, needsReview } = partitionSidebarChats(chats);
    expect(primary.map((c) => c.id)).toEqual(["older-run", "recent-done"]);
    expect(needsReview.map((c) => c.id)).toEqual(["failed"]);
  });

  it("collapses retry-heavy duplicate titles in needs review", () => {
    const retries = Array.from({ length: 8 }, (_, i) =>
      chat(
        `retry-${i}`,
        "failed",
        `2026-07-31T1${i}:00:00.000Z`,
        false,
        "Fix the deploy script",
      ),
    );
    // Newest first (buildChats order)
    const chats = [...retries].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    const { primary, needsReview } = partitionSidebarChats(chats);
    expect(primary).toHaveLength(0);
    expect(needsReview).toHaveLength(1);
    expect(needsReview[0]!.title).toBe("Fix the deploy script");
  });

  it("caps primary so long histories do not flood the rail", () => {
    const many = Array.from({ length: SIDEBAR_MAX_PRIMARY + 10 }, (_, i) =>
      chat(
        `d${i}`,
        "done",
        `2026-07-${String(30 - (i % 28)).padStart(2, "0")}T12:00:00.000Z`,
        false,
        `Task ${i}`,
      ),
    );
    const live = chat("live", "running", "2026-07-31T20:00:00.000Z");
    const { primary } = partitionSidebarChats([live, ...many]);
    expect(primary.length).toBeLessThanOrEqual(SIDEBAR_MAX_PRIMARY);
    expect(primary[0]!.id).toBe("live");
  });

  it("caps needs review after dedupe", () => {
    const many = Array.from({ length: SIDEBAR_MAX_NEEDS_REVIEW + 5 }, (_, i) =>
      chat(
        `f${i}`,
        "failed",
        `2026-07-30T${String(i).padStart(2, "0")}:00:00.000Z`,
        false,
        `Unique fail ${i}`,
      ),
    );
    const { needsReview } = partitionSidebarChats(many);
    expect(needsReview).toHaveLength(SIDEBAR_MAX_NEEDS_REVIEW);
  });
});

describe("partitionFolderChats", () => {
  it("mirrors partition for folder groups", () => {
    const { primary, needsReview } = partitionFolderChats([
      chat("1", "done"),
      chat("2", "failed"),
    ]);
    expect(primary).toHaveLength(1);
    expect(needsReview).toHaveLength(1);
  });
});
