import { describe, expect, it } from "vitest";
import {
  emptyPinStore,
  isPinned,
  pinChat,
  prunePins,
  sortChatsWithPins,
  togglePin,
  unpinChat,
} from "./pinned-chats";

describe("pinned-chats", () => {
  it("pins to front and sorts accordingly", () => {
    let store = emptyPinStore();
    store = pinChat(store, "c2");
    store = pinChat(store, "c1");
    expect(isPinned(store, "c1")).toBe(true);

    const sorted = sortChatsWithPins(
      [
        { id: "c3", updatedAt: "2026-07-15T12:00:00.000Z" },
        { id: "c2", updatedAt: "2026-07-15T11:00:00.000Z" },
        { id: "c1", updatedAt: "2026-07-15T10:00:00.000Z" },
      ],
      store,
    );
    expect(sorted.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);

    store = unpinChat(store, "c1");
    expect(togglePin(store, "c1").ids[0]).toBe("c1");
  });

  it("prunes deleted chats", () => {
    let store = pinChat(emptyPinStore(), "gone");
    store = pinChat(store, "keep");
    store = prunePins(store, new Set(["keep"]));
    expect(store.ids).toEqual(["keep"]);
  });
});
