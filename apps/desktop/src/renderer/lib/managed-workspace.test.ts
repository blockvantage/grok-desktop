import { describe, it, expect } from "vitest";
import {
  isManagedWorkspacePath,
  userFacingWorkspaceRoot,
  filterUserWorkspaceRoots,
} from "./managed-workspace";

describe("isManagedWorkspacePath", () => {
  it("treats empty as managed", () => {
    expect(isManagedWorkspacePath("")).toBe(true);
    expect(isManagedWorkspacePath(null)).toBe(true);
    expect(isManagedWorkspacePath(undefined)).toBe(true);
  });

  it("detects GrokDesk workspaces and grok-chat prefixes", () => {
    expect(
      isManagedWorkspacePath(
        "/Users/me/Library/Application Support/GrokDesk/workspaces/grok-chat-abc",
      ),
    ).toBe(true);
    expect(isManagedWorkspacePath("/tmp/grok-chat-xyz")).toBe(true);
    expect(isManagedWorkspacePath("/var/folders/T/grokdesk-chat-old")).toBe(
      true,
    );
  });

  it("keeps real project folders", () => {
    expect(isManagedWorkspacePath("/Users/me/code/my-app")).toBe(false);
    expect(isManagedWorkspacePath("~/Documents/project")).toBe(false);
  });
});

describe("userFacingWorkspaceRoot", () => {
  it("skips managed primary and returns first user root", () => {
    expect(
      userFacingWorkspaceRoot([
        "/Library/Application Support/GrokDesk/workspaces/grok-chat-x",
        "/Users/me/code/app",
      ]),
    ).toBe("/Users/me/code/app");
  });

  it("returns empty when only managed roots exist", () => {
    expect(
      userFacingWorkspaceRoot([
        "/Library/Application Support/GrokDesk/workspaces/grok-chat-x",
      ]),
    ).toBe("");
  });
});

describe("filterUserWorkspaceRoots", () => {
  it("drops managed paths", () => {
    expect(
      filterUserWorkspaceRoots([
        "/GrokDesk/workspaces/grok-chat-a",
        "/Users/me/proj",
        "",
      ]),
    ).toEqual(["/Users/me/proj"]);
  });
});
