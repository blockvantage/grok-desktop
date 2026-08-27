import { describe, expect, it } from "vitest";
import {
  applyWaitingOnYouEvent,
  emptyWaitingOnYou,
  projectWaitingOnYou,
  waitingOnYouTaskIds,
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

  it("folds waiting_approval and waiting_user tasks onto the same stream", () => {
    const state = projectWaitingOnYou({
      tasks: [
        {
          id: "t-ask",
          status: "waiting_approval",
          title: "Allow writing launch-brief.md?",
        },
        {
          id: "t-q",
          status: "waiting_user",
          goal: "Which tone?",
        },
        { id: "t-run", status: "running", title: "Working" },
      ],
    });
    expect(state.inboxBadge).toBe(2);
    expect(state.needsInput).toBe(true);
    expect(state.notificationTitle).toBe("Which tone?");
    expect(state.pending.map((p) => p.kind)).toEqual(["permission", "question"]);
    expect(waitingOnYouTaskIds(state)).toEqual(["t-ask", "t-q"]);
  });

  it("does not double-count a parked task already represented by a live event", () => {
    const state = projectWaitingOnYou({
      events: [
        {
          type: "pending_interaction",
          raw: {
            id: "p1",
            kind: "permission",
            title: "Allow writing launch-brief.md?",
            taskId: "t-ask",
          },
        },
      ],
      tasks: [
        {
          id: "t-ask",
          status: "waiting_approval",
          title: "Allow writing launch-brief.md?",
        },
      ],
    });
    expect(state.inboxBadge).toBe(1);
    expect(state.pending[0]).toMatchObject({
      id: "p1",
      taskId: "t-ask",
    });
  });

  it("clears when the parked task leaves waiting_*", () => {
    const waiting = projectWaitingOnYou({
      tasks: [{ id: "t1", status: "waiting_approval", title: "Approve?" }],
    });
    expect(waiting.needsInput).toBe(true);
    const done = projectWaitingOnYou({
      tasks: [{ id: "t1", status: "running", title: "Approve?" }],
    });
    expect(done).toEqual(emptyWaitingOnYou());
  });

  it("maps permission_request / approval_resolved onto the same projector", () => {
    let state = projectWaitingOnYou({
      events: [
        {
          type: "permission_request",
          id: "perm-1",
          command: "Run rm -rf?",
          taskId: "t1",
        },
      ],
    });
    expect(state).toMatchObject({
      inboxBadge: 1,
      needsInput: true,
      notificationTitle: "Run rm -rf?",
    });
    state = projectWaitingOnYou({
      events: [
        {
          type: "permission_request",
          id: "perm-1",
          command: "Run rm -rf?",
          taskId: "t1",
        },
        { type: "approval_resolved", id: "perm-1" },
      ],
    });
    expect(state).toEqual(emptyWaitingOnYou());
  });
});
