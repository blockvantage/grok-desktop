import { describe, it, expect } from "vitest";
import { inboxWorkspaceRoots } from "./inbox-workspace-roots";

describe("inboxWorkspaceRoots", () => {
  it("returns single trimmed root or empty", () => {
    expect(inboxWorkspaceRoots("  /ws  ")).toEqual(["/ws"]);
    expect(inboxWorkspaceRoots("   ")).toEqual([]);
    expect(inboxWorkspaceRoots("")).toEqual([]);
  });
});
