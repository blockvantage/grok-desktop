import { describe, it, expect } from "vitest";
import { scheduleCreateParams } from "./schedule-create-params";

describe("scheduleCreateParams", () => {
  it("maps form fields and defaults empty timezone to UTC", () => {
    expect(
      scheduleCreateParams({
        form: {
          name: "Daily",
          goal: "standup",
          cron: "0 9 * * *",
          model: "grok-4.5",
        },
        root: "/ws",
        timezone: "  ",
      }),
    ).toEqual({
      name: "Daily",
      goalTemplate: "standup",
      cron: "0 9 * * *",
      timezone: "UTC",
      workspaceRoots: ["/ws"],
      model: "grok-4.5",
    });
  });

  it("preserves timezone", () => {
    expect(
      scheduleCreateParams({
        form: {
          name: "n",
          goal: "g",
          cron: "c",
          model: "m",
        },
        root: "/r",
        timezone: "America/New_York",
      }).timezone,
    ).toBe("America/New_York");
  });
});
