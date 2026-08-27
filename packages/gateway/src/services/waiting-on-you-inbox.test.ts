import { describe, expect, it } from "vitest";
import { projectWaitingOnYou } from "@grokdesk/shared";
import { syncInboxFromWaitingOnYou } from "./waiting-on-you-inbox.js";

describe("syncInboxFromWaitingOnYou", () => {
  it("writes one inbox row per pending projector item", () => {
    const added: Array<{ kind: string; title: string; taskId: string | null }> =
      [];
    const view = projectWaitingOnYou({
      tasks: [
        {
          id: "t1",
          status: "waiting_approval",
          title: "Allow writing launch-brief.md?",
        },
        { id: "t2", status: "waiting_user", goal: "Which tone?" },
      ],
    });
    const n = syncInboxFromWaitingOnYou(
      {
        addDeduped: (input) => {
          added.push({
            kind: input.kind,
            title: input.title,
            taskId: input.taskId ?? null,
          });
          return input;
        },
      },
      view,
    );
    expect(n).toBe(2);
    expect(added).toEqual([
      {
        kind: "approval",
        title: "Allow writing launch-brief.md?",
        taskId: "t1",
      },
      { kind: "clarification", title: "Which tone?", taskId: "t2" },
    ]);
  });

  it("skips when addDeduped returns null (already notified)", () => {
    const view = projectWaitingOnYou({
      tasks: [{ id: "t1", status: "waiting_approval", title: "Approve?" }],
    });
    const n = syncInboxFromWaitingOnYou(
      { addDeduped: () => null },
      view,
    );
    expect(n).toBe(0);
  });
});
