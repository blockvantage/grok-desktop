import { describe, expect, it } from "vitest";
import {
  decodeScheduledTaskEvent,
  engineScheduleDeskId,
} from "./scheduled-task-event.js";

describe("decodeScheduledTaskEvent", () => {
  it("decodes created/fired/deleted and maps interval to cron", () => {
    const created = decodeScheduledTaskEvent({
      sessionUpdate: "ScheduledTaskCreated",
      id: "st-1",
      prompt: "Check deploy",
      interval: "30m",
    });
    expect(created).toMatchObject({
      engineId: "st-1",
      prompt: "Check deploy",
      action: "created",
      cron: "*/30 * * * *",
    });
    expect(
      decodeScheduledTaskEvent({
        sessionUpdate: "ScheduledTaskDeleted",
        engine_id: "st-1",
      })?.action,
    ).toBe("deleted");
    expect(
      decodeScheduledTaskEvent({
        type: "scheduled_task_fired",
        id: "st-1",
        prompt: "Check deploy",
      })?.action,
    ).toBe("fired");
  });

  it("never throws and mints a stable desk id", () => {
    expect(decodeScheduledTaskEvent(null)).toBeNull();
    expect(engineScheduleDeskId("abc/def")).toBe("eng-abcdef");
  });
});
