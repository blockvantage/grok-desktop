import { describe, expect, it } from "vitest";
import {
  emptyWorkSession,
  resolveResumeIntent,
  shouldOfferResume,
  touchWorkSession,
} from "./work-session";

describe("work-session", () => {
  it("offers resume for recent draft or conversation", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const s = touchWorkSession(
      emptyWorkSession(),
      {
        conversationId: "chat_1",
        draft: "Continue the launch plan with budget",
        surface: "workspace",
      },
      "2026-07-15T10:00:00.000Z",
    );
    expect(shouldOfferResume(s, now)).toBe(true);
    expect(resolveResumeIntent(s, now)).toEqual({
      type: "open_conversation",
      conversationId: "chat_1",
      draft: "Continue the launch plan with budget",
    });
  });

  it("restores home draft when surface is home", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const s = touchWorkSession(
      emptyWorkSession(),
      {
        draft: "Draft a partner email sequence",
        surface: "home",
        workspaceRoot: "/Users/me/project",
      },
      "2026-07-15T11:00:00.000Z",
    );
    expect(resolveResumeIntent(s, now)).toEqual({
      type: "restore_home_draft",
      draft: "Draft a partner email sequence",
      workspaceRoot: "/Users/me/project",
    });
  });

  it("does not offer stale sessions", () => {
    const s = touchWorkSession(
      emptyWorkSession(),
      { draft: "old enough to ignore", surface: "home" },
      "2026-01-01T00:00:00.000Z",
    );
    expect(shouldOfferResume(s, new Date("2026-07-15T00:00:00.000Z"))).toBe(
      false,
    );
  });

  it("does not resurrect a deliberately cleared empty home draft", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const s = touchWorkSession(
      emptyWorkSession(),
      {
        draft: "",
        draftCleared: true,
        surface: "home",
        attachmentPaths: [],
      },
      "2026-07-15T11:00:00.000Z",
    );
    expect(shouldOfferResume(s, now)).toBe(false);
    expect(resolveResumeIntent(s, now)).toEqual({ type: "none" });
  });

  it("preserves attachmentPaths on touch", () => {
    const s = touchWorkSession(emptyWorkSession(), {
      draft: "with files",
      attachmentPaths: ["/tmp/a.png", "/tmp/b.pdf"],
    });
    expect(s.attachmentPaths).toEqual(["/tmp/a.png", "/tmp/b.pdf"]);
  });
});
