import { describe, expect, it } from "vitest";
import {
  clearFollowUpDraft,
  emptyFollowUpDrafts,
  FOLLOW_UP_DRAFT_MAX_AGE_MS,
  FOLLOW_UP_DRAFTS_KEY,
  loadFollowUpDraft,
  loadFollowUpDrafts,
  pruneFollowUpDrafts,
  saveFollowUpDraft,
  saveFollowUpDrafts,
  type FollowUpDraftsMap,
} from "./follow-up-drafts";

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    key: (i) => [...map.keys()][i] ?? null,
  } as Storage;
}

describe("follow-up-drafts", () => {
  it("saves and loads a draft per task", () => {
    const storage = memStorage();
    const now = Date.parse("2026-07-17T12:00:00.000Z");
    saveFollowUpDraft(
      "task_a",
      { text: "follow up on pricing", attachmentPaths: ["/a.png"] },
      storage,
      now,
    );
    expect(loadFollowUpDraft("task_a", storage, now)).toEqual({
      text: "follow up on pricing",
      attachmentPaths: ["/a.png"],
      updatedAt: "2026-07-17T12:00:00.000Z",
    });
    expect(loadFollowUpDraft("task_b", storage, now)).toBeNull();
  });

  it("clears on explicit clear and empty text+attachments", () => {
    const storage = memStorage();
    const now = Date.parse("2026-07-17T12:00:00.000Z");
    saveFollowUpDraft("task_a", { text: "keep me" }, storage, now);
    clearFollowUpDraft("task_a", storage, now);
    expect(loadFollowUpDraft("task_a", storage, now)).toBeNull();

    saveFollowUpDraft("task_a", { text: "again" }, storage, now);
    saveFollowUpDraft("task_a", { text: "  ", attachmentPaths: [] }, storage, now);
    expect(loadFollowUpDraft("task_a", storage, now)).toBeNull();
  });

  it("prunes drafts older than 14 days on load", () => {
    const storage = memStorage();
    const now = Date.parse("2026-07-17T12:00:00.000Z");
    const stale: FollowUpDraftsMap = {
      old: {
        text: "stale",
        attachmentPaths: [],
        updatedAt: new Date(now - FOLLOW_UP_DRAFT_MAX_AGE_MS - 1).toISOString(),
      },
      fresh: {
        text: "fresh",
        attachmentPaths: [],
        updatedAt: new Date(now - 1000).toISOString(),
      },
    };
    saveFollowUpDrafts(stale, storage, now);
    // Force raw write with both, then load should prune
    storage.setItem(FOLLOW_UP_DRAFTS_KEY, JSON.stringify(stale));
    const loaded = loadFollowUpDrafts(storage, now);
    expect(Object.keys(loaded)).toEqual(["fresh"]);
    expect(pruneFollowUpDrafts(stale, now).old).toBeUndefined();
    expect(pruneFollowUpDrafts(stale, now).fresh?.text).toBe("fresh");
  });

  it("returns empty map for corrupt storage", () => {
    const storage = memStorage();
    storage.setItem(FOLLOW_UP_DRAFTS_KEY, "{not json");
    expect(loadFollowUpDrafts(storage)).toEqual(emptyFollowUpDrafts());
  });

  it("isolates drafts across tasks", () => {
    const storage = memStorage();
    const now = Date.parse("2026-07-17T12:00:00.000Z");
    saveFollowUpDraft("t1", { text: "one" }, storage, now);
    saveFollowUpDraft("t2", { text: "two", attachmentPaths: ["/x"] }, storage, now);
    expect(loadFollowUpDraft("t1", storage, now)?.text).toBe("one");
    expect(loadFollowUpDraft("t2", storage, now)?.attachmentPaths).toEqual([
      "/x",
    ]);
    clearFollowUpDraft("t1", storage, now);
    expect(loadFollowUpDraft("t2", storage, now)?.text).toBe("two");
  });
});
