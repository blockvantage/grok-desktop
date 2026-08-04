import { describe, it, expect } from "vitest";
import {
  CONVERSATION_I18N,
  conversationCountLabel,
  usesTaskAsUserNoun,
} from "./conversation-noun";

describe("conversation noun", () => {
  it("exposes conversation i18n keys not task list keys", () => {
    expect(CONVERSATION_I18N.listTitle).toContain("conversation");
    expect(CONVERSATION_I18N.listTitle).not.toContain("task");
  });

  it("formats count with conversation wording", () => {
    const one = conversationCountLabel(1, (k, v) =>
      k === "conversation.countOne" ? `${v?.count} conversation` : k,
    );
    const many = conversationCountLabel(3, (k, v) =>
      k === "conversation.countMany" ? `${v?.count} conversations` : k,
    );
    expect(one).toBe("1 conversation");
    expect(many).toBe("3 conversations");
  });

  it("detects task-as-noun for copy audits", () => {
    expect(usesTaskAsUserNoun("Delete this task?")).toBe(true);
    expect(usesTaskAsUserNoun("Open conversation")).toBe(false);
  });
});
