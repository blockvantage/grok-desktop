import { describe, it, expect } from "vitest";
import { resolveChatRootId } from "./chat-root";

const t = (
  id: string,
  parentTaskId: string | null = null,
): { id: string; parentTaskId: string | null } => ({ id, parentTaskId });

describe("resolveChatRootId", () => {
  it("returns self when no parent", () => {
    expect(resolveChatRootId(t("a"))).toBe("a");
  });

  it("walks parent chain within thread", () => {
    const thread = [t("root"), t("c1", "root"), t("c2", "c1")];
    expect(resolveChatRootId(thread[2]!, thread)).toBe("root");
  });

  it("uses explicit root when parent missing from thread", () => {
    const thread = [t("root"), t("leaf", "missing-parent")];
    // leaf has parent not in map; roots[0] is root
    expect(resolveChatRootId(thread[1]!, thread)).toBe("root");
  });

  it("returns current when only orphaned child in thread", () => {
    expect(resolveChatRootId(t("orphan", "gone"), [t("orphan", "gone")])).toBe(
      "orphan",
    );
  });
});
