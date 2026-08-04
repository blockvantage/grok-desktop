import { describe, it, expect } from "vitest";
import {
  primaryRootsFromTasks,
  tasksHaveWorkspaceRoot,
} from "./task-primary-roots";

describe("primaryRootsFromTasks", () => {
  it("collects non-empty user-facing roots (skips managed)", () => {
    expect(
      primaryRootsFromTasks([
        { policySnapshot: { workspaceRoots: ["/a", "/x"] } },
        { policySnapshot: { workspaceRoots: [] } },
        { policySnapshot: { workspaceRoots: ["  ", "/b"] } },
        { policySnapshot: { workspaceRoots: ["/c"] } },
        {
          policySnapshot: {
            workspaceRoots: [
              "/Library/Application Support/GrokDesk/workspaces/grok-chat-z",
            ],
          },
        },
      ]),
    ).toEqual(["/a", "/b", "/c"]);
  });
});

describe("tasksHaveWorkspaceRoot", () => {
  it("true when any user-facing root is non-empty", () => {
    expect(
      tasksHaveWorkspaceRoot([
        { policySnapshot: { workspaceRoots: [] } },
        { policySnapshot: { workspaceRoots: ["/ws"] } },
      ]),
    ).toBe(true);
    expect(
      tasksHaveWorkspaceRoot([{ policySnapshot: { workspaceRoots: [""] } }]),
    ).toBe(false);
    expect(
      tasksHaveWorkspaceRoot([
        {
          policySnapshot: {
            workspaceRoots: [
              "/Library/Application Support/GrokDesk/workspaces/grok-chat-z",
            ],
          },
        },
      ]),
    ).toBe(false);
  });
});
