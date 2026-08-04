import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  isManagedWorkspaceRoot,
  collectManagedRootsToDelete,
} from "./workspace-managed.js";

describe("isManagedWorkspaceRoot", () => {
  const dataDir = "/Users/me/Library/Application Support/GrokDesk";

  it("accepts nested chat workspaces", () => {
    expect(
      isManagedWorkspaceRoot(
        path.join(dataDir, "workspaces", "chat-abc"),
        dataDir,
      ),
    ).toBe(true);
  });

  it("rejects the workspaces base itself", () => {
    expect(
      isManagedWorkspaceRoot(path.join(dataDir, "workspaces"), dataDir),
    ).toBe(false);
  });

  it("rejects user project folders", () => {
    expect(isManagedWorkspaceRoot("/Users/me/code/my-app", dataDir)).toBe(
      false,
    );
  });

  it("rejects sibling paths that only share a prefix string", () => {
    // /.../workspaces-evil should not match /.../workspaces/
    expect(
      isManagedWorkspaceRoot(
        path.join(dataDir, "workspaces-evil", "x"),
        dataDir,
      ),
    ).toBe(false);
  });

  it("treats Windows drive-letter case as the same root", () => {
    if (process.platform !== "win32") return;
    const data = "C:\\Users\\me\\AppData\\Roaming\\GrokDesk";
    const chat = "c:\\Users\\me\\AppData\\Roaming\\GrokDesk\\workspaces\\chat-1";
    expect(isManagedWorkspaceRoot(chat, data)).toBe(true);
    expect(
      isManagedWorkspaceRoot(
        "c:\\Users\\me\\AppData\\Roaming\\GrokDesk\\workspaces",
        data,
      ),
    ).toBe(false);
  });
});

describe("collectManagedRootsToDelete", () => {
  const dataDir = "/app/data";

  it("dedupes and filters to managed only", () => {
    const managed = path.join(dataDir, "workspaces", "c1");
    const roots = collectManagedRootsToDelete(
      [managed, managed, "/user/project", null, undefined],
      dataDir,
    );
    expect(roots).toEqual([path.resolve(managed)]);
  });
});
