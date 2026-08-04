import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listWorkspaceFiles } from "./workspace-list.js";
import { PATH_OUTSIDE_WORKSPACE_ROOTS } from "./workspace-path-confine.js";

describe("listWorkspaceFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-list-"));
    fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lists files under an allowed root", () => {
    const rows = listWorkspaceFiles(dir, 40, [dir]);
    expect(rows.some((r) => r.name === "a.txt")).toBe(true);
  });

  it("rejects roots outside allowed set", () => {
    expect(() => listWorkspaceFiles(dir, 40, ["/var/empty-allowed"])).toThrow(
      PATH_OUTSIDE_WORKSPACE_ROOTS,
    );
  });

  it("rejects empty allowed roots fail-closed", () => {
    expect(() => listWorkspaceFiles(dir, 40, [])).toThrow(
      PATH_OUTSIDE_WORKSPACE_ROOTS,
    );
  });
});
