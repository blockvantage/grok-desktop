import { describe, expect, it } from "vitest";
import {
  decodeSessionSearchResponse,
  isSessionsChangedNotification,
  lastTurnSummaryFromText,
  listDeskConversations,
  parseSessionHeadlessPolicy,
  rosterActivityFromStatus,
  searchDeskConversations,
  SESSION_HEADLESS_DEFAULT,
} from "./session-roster.js";

describe("roster activity", () => {
  it("maps Desk statuses onto working/idle/needs_input/dormant/completed", () => {
    expect(rosterActivityFromStatus({ status: "running" })).toBe("working");
    expect(rosterActivityFromStatus({ status: "queued" })).toBe("working");
    expect(rosterActivityFromStatus({ status: "waiting_user" })).toBe(
      "needs_input",
    );
    expect(
      rosterActivityFromStatus({ status: "failed", needsInput: true }),
    ).toBe("needs_input");
    expect(rosterActivityFromStatus({ status: "done" })).toBe("completed");
    expect(rosterActivityFromStatus({ status: "cancelled" })).toBe("dormant");
    expect(rosterActivityFromStatus({ status: "unknown" })).toBe("idle");
  });
});

describe("session search decode", () => {
  it("defaults headless exclude and surfaces bootstrapping as still indexing", () => {
    expect(SESSION_HEADLESS_DEFAULT).toBe("exclude");
    const boot = decodeSessionSearchResponse({
      status: "bootstrapping",
      results: [
        {
          sessionId: "s1",
          title: "Ship brief",
          last_turn_summary: "Drafted three channels",
          session_kind: "interactive",
        },
        {
          session_id: "h1",
          summary: "one-shot",
          session_kind: "headless",
        },
      ],
    });
    expect(boot.status).toBe("bootstrapping");
    expect(boot.hits.map((h) => h.sessionId)).toEqual(["s1"]);
    expect(boot.hits[0]!.lastTurnSummary).toBe("Drafted three channels");
  });

  it("includes headless rows only when asked", () => {
    const raw = {
      sessions: [
        { id: "a", title: "A", sessionKind: "interactive" },
        { id: "b", title: "B", sessionKind: "headless" },
      ],
    };
    expect(
      decodeSessionSearchResponse(raw, { headless: "only" }).hits.map(
        (h) => h.sessionId,
      ),
    ).toEqual(["b"]);
    expect(
      decodeSessionSearchResponse(raw, { headless: "include" }).hits,
    ).toHaveLength(2);
  });

  it("never throws on unknown envelopes", () => {
    expect(decodeSessionSearchResponse(null).hits).toEqual([]);
    expect(decodeSessionSearchResponse("nope").status).toBe("ready");
  });
});

describe("desk conversation search", () => {
  it("matches title and goal, not unrelated chats", () => {
    const hits = searchDeskConversations(
      [
        {
          id: "1",
          title: "Launch brief",
          goal: "Write the Q3 brief",
          status: "done",
        },
        { id: "2", title: "Plumbing", goal: "Fix the sink", status: "done" },
      ],
      "brief",
    );
    expect(hits.map((h) => h.sessionId)).toEqual(["1"]);
    expect(hits[0]!.lastTurnSummary).toContain("Q3");
  });

  it("lists all chats when not searching, and empty query is not a wildcard", () => {
    const rows = [
      { id: "1", title: "Launch brief", goal: "Write the Q3 brief" },
      { id: "2", title: "Plumbing", goal: "Fix the sink" },
    ];
    expect(searchDeskConversations(rows, "   ")).toEqual([]);
    expect(listDeskConversations(rows).map((h) => h.sessionId)).toEqual([
      "1",
      "2",
    ]);
    expect(parseSessionHeadlessPolicy("only")).toBe("only");
    expect(parseSessionHeadlessPolicy("nope")).toBe("exclude");
  });
});

describe("helpers", () => {
  it("clips last-turn summaries and recognizes sessions/changed", () => {
    expect(lastTurnSummaryFromText("  Hello world. More.  ")).toBe(
      "Hello world.",
    );
    expect(isSessionsChangedNotification("x.ai/sessions/changed")).toBe(true);
    expect(isSessionsChangedNotification("session/update")).toBe(false);
  });
});
