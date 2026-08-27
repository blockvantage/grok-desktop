import { describe, expect, it } from "vitest";
import {
  applyWaitingOnYouEvent,
  emptyWaitingOnYou,
} from "./waiting-on-you.js";

describe("waiting-on-you projector", () => {
  it("one pending stream sets inbox, needs_input, and notification, then clears", () => {
    let state = emptyWaitingOnYou();
    state = applyWaitingOnYouEvent(state, {
      type: "pending",
      raw: {
        sessionUpdate: "pending_interaction",
        id: "p1",
        kind: "permission",
        title: "Allow writing launch-brief.md?",
      },
    });
    expect(state).toMatchObject({
      inboxBadge: 1,
      needsInput: true,
      notificationTitle: "Allow writing launch-brief.md?",
    });
    state = applyWaitingOnYouEvent(state, {
      type: "resolved",
      raw: { sessionUpdate: "interaction_resolved", id: "p1" },
    });
    expect(state).toEqual(emptyWaitingOnYou());
  });

  it("maps ask_user and mcp elicitation onto the same surface", () => {
    let state = emptyWaitingOnYou();
    state = applyWaitingOnYouEvent(state, {
      type: "pending",
      raw: { id: "q1", kind: "ask_user_question", title: "Which tone?" },
    });
    state = applyWaitingOnYouEvent(state, {
      type: "pending",
      raw: { id: "m1", kind: "mcp_elicitation", title: "Connect Drive" },
    });
    expect(state.pending.map((p) => p.kind)).toEqual([
      "question",
      "mcp_elicitation",
    ]);
    expect(state.inboxBadge).toBe(2);
  });
});
