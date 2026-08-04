import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PATH_OUTSIDE_WORKSPACE_ROOTS,
  assertPathInsideWorkspaceRoots,
  collectAllowedWorkspaceRoots,
  confineExistingWorkspacePath,
} from "./workspace-path-confine.js";

describe("workspace-path-confine", () => {
  it("allows paths under a configured root", () => {
    const root = path.resolve("/tmp/ws-root");
    expect(() =>
      assertPathInsideWorkspaceRoots(path.join(root, "a.txt"), [root]),
    ).not.toThrow();
  });

  it("denies paths outside all roots", () => {
    const root = path.resolve("/tmp/ws-root");
    expect(() =>
      assertPathInsideWorkspaceRoots(path.resolve("/etc/passwd"), [root]),
    ).toThrow(PATH_OUTSIDE_WORKSPACE_ROOTS);
  });

  it("fail-closed when roots empty", () => {
    expect(() =>
      assertPathInsideWorkspaceRoots(path.resolve("/tmp/x"), []),
    ).toThrow(PATH_OUTSIDE_WORKSPACE_ROOTS);
  });

  it("collectAllowedWorkspaceRoots includes managed base and task roots", () => {
    const dataDir = path.resolve("/data/app");
    const project = path.resolve("/Users/me/project");
    const roots = collectAllowedWorkspaceRoots({
      dataDir,
      taskRoots: [project, "  ", null, undefined],
    });
    expect(roots).toContain(path.resolve(dataDir, "workspaces"));
    expect(roots).toContain(project);
    expect(roots).toHaveLength(2);
  });
});

describe("confineExistingWorkspacePath (symlink escape)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-ws-confine-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("allows a real file inside the root", () => {
    const file = path.join(dir, "note.txt");
    fs.writeFileSync(file, "hi");
    expect(confineExistingWorkspacePath(file, [dir])).toBe(
      fs.realpathSync(file),
    );
  });

  it("denies a symlink inside the root that points outside", () => {
    const outside = path.join(os.tmpdir(), `gd-outside-${Date.now()}.txt`);
    fs.writeFileSync(outside, "secret");
    try {
      const link = path.join(dir, "escape.txt");
      fs.symlinkSync(outside, link);
      expect(() => confineExistingWorkspacePath(link, [dir])).toThrow(
        PATH_OUTSIDE_WORKSPACE_ROOTS,
      );
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("returns lexical path when target does not exist yet", () => {
    const missing = path.join(dir, "missing.txt");
    expect(confineExistingWorkspacePath(missing, [dir])).toBe(
      path.resolve(missing),
    );
  });
});
