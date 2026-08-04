import { describe, it, expect } from "vitest";
import {
  isActiveTaskStatusForBrowser,
  threadHasActiveBrowserUsers,
} from "./thread-browser-users.js";

describe("threadHasActiveBrowserUsers", () => {
  it("ignores excluded task and terminal siblings", () => {
    expect(
      threadHasActiveBrowserUsers(
        [
          { id: "a", status: "running" },
          { id: "b", status: "done" },
        ],
        "a",
      ),
    ).toBe(false);
  });

  it("detects other active members", () => {
    expect(
      threadHasActiveBrowserUsers(
        [
          { id: "a", status: "done" },
          { id: "b", status: "waiting_approval" },
        ],
        "a",
      ),
    ).toBe(true);
  });

  it("isActiveTaskStatusForBrowser covers active set", () => {
    expect(isActiveTaskStatusForBrowser("running")).toBe(true);
    expect(isActiveTaskStatusForBrowser("done")).toBe(false);
  });
});
