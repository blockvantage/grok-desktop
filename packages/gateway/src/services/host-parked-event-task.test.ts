import { describe, it, expect } from "vitest";
import { eventTaskIdForHostParkedApproval } from "./host-parked-event-task.js";

describe("eventTaskIdForHostParkedApproval", () => {
  it("prefers live thread task", () => {
    expect(
      eventTaskIdForHostParkedApproval({
        browserSessionId: "root",
        liveFromThread: { id: "child" },
        taskFromSession: { id: "root" },
      }),
    ).toBe("child");
  });

  it("falls back to session task then session id", () => {
    expect(
      eventTaskIdForHostParkedApproval({
        browserSessionId: "root",
        liveFromThread: null,
        taskFromSession: { id: "root" },
      }),
    ).toBe("root");
    expect(
      eventTaskIdForHostParkedApproval({
        browserSessionId: "root",
        liveFromThread: undefined,
        taskFromSession: null,
      }),
    ).toBe("root");
  });
});
