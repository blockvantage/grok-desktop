import { describe, it, expect } from "vitest";
import { selectedChatKey } from "./selected-chat-key";

describe("selectedChatKey", () => {
  it("joins turn ids for a chat", () => {
    expect(
      selectedChatKey(
        { turns: [{ id: "a" }, { id: "b" }] },
        "b",
      ),
    ).toBe("a,b");
  });

  it("falls back to selectedId", () => {
    expect(selectedChatKey(null, "solo")).toBe("solo");
    expect(selectedChatKey(undefined, null)).toBe("");
  });
});
