import { describe, expect, it } from "vitest";
import {
  getLastSeenSeq,
  markTaskSeen,
  maxBlockSeq,
  UNREAD_SEEN_KEY,
  unreadBoundarySeq,
} from "./unread-boundary";

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

describe("unreadBoundarySeq", () => {
  const blocks = [{ seq: 1 }, { seq: 3 }, { seq: 5 }, { seq: 8 }];

  it("returns null when lastSeen is null/undefined (first visit)", () => {
    expect(unreadBoundarySeq(null, blocks)).toBeNull();
    expect(unreadBoundarySeq(undefined, blocks)).toBeNull();
  });

  it("returns the first unseen seq", () => {
    expect(unreadBoundarySeq(3, blocks)).toBe(5);
    expect(unreadBoundarySeq(0, blocks)).toBe(1);
    expect(unreadBoundarySeq(4, blocks)).toBe(5);
  });

  it("returns null when fully caught up", () => {
    expect(unreadBoundarySeq(8, blocks)).toBeNull();
    expect(unreadBoundarySeq(99, blocks)).toBeNull();
    expect(unreadBoundarySeq(5, [])).toBeNull();
  });

  it("maxBlockSeq returns the high water mark", () => {
    expect(maxBlockSeq(blocks)).toBe(8);
    expect(maxBlockSeq([])).toBe(0);
  });
});

describe("unread seen persistence", () => {
  it("stores and loads last-seen seq per task", () => {
    const storage = memStorage();
    const now = Date.parse("2026-07-17T12:00:00.000Z");
    expect(getLastSeenSeq("task_a", storage, now)).toBeNull();
    markTaskSeen("task_a", 12, storage, now);
    expect(getLastSeenSeq("task_a", storage, now)).toBe(12);
    markTaskSeen("task_a", 10, storage, now);
    // never regress
    expect(getLastSeenSeq("task_a", storage, now)).toBe(12);
    markTaskSeen("task_a", 20, storage, now);
    expect(getLastSeenSeq("task_a", storage, now)).toBe(20);
    expect(getLastSeenSeq("task_b", storage, now)).toBeNull();
    expect(storage.getItem(UNREAD_SEEN_KEY)).toBeTruthy();
  });
});
