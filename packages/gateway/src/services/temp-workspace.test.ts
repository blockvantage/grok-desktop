import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cleanupEmptyOrphanWorkspaces,
  ensureTempWorkspace,
  resolveTaskWorkspaceRoots,
  sanitizeWorkspaceLabel,
} from "./temp-workspace.js";
import { isManagedWorkspaceRoot } from "./workspace-managed.js";

describe("temp-workspace", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-tw-"));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("sanitizeWorkspaceLabel strips unsafe characters", () => {
    expect(sanitizeWorkspaceLabel("My Chat!!")).toBe("My-Chat-");
    expect(sanitizeWorkspaceLabel("")).toBe("chat");
  });

  it("ensureTempWorkspace creates managed dir under dataDir/workspaces", () => {
    const dir = ensureTempWorkspace(dataDir, "chat");
    expect(fs.existsSync(dir)).toBe(true);
    expect(isManagedWorkspaceRoot(dir, dataDir)).toBe(true);
    expect(dir).toMatch(/grok-chat-/);
  });

  it("resolveTaskWorkspaceRoots inherits parent roots", () => {
    const roots = resolveTaskWorkspaceRoots({
      dataDir,
      parentRoots: ["/proj/a", "/proj/b"],
      workspaceRoots: ["/ignored"],
    });
    expect(roots).toEqual([
      path.resolve("/proj/a"),
      path.resolve("/proj/b"),
    ]);
  });

  it("resolveTaskWorkspaceRoots puts user project first when provided", () => {
    const user = path.join(dataDir, "user-proj");
    fs.mkdirSync(user);
    const roots = resolveTaskWorkspaceRoots({
      dataDir,
      workspaceRoots: [user],
    });
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBe(path.resolve(user));
    expect(isManagedWorkspaceRoot(roots[1]!, dataDir)).toBe(true);
  });

  it("resolveTaskWorkspaceRoots uses managed root alone when no user folder", () => {
    const roots = resolveTaskWorkspaceRoots({
      dataDir,
      workspaceRoots: [],
    });
    expect(roots).toHaveLength(1);
    expect(isManagedWorkspaceRoot(roots[0]!, dataDir)).toBe(true);
  });

  it("removes only empty, unreferenced managed roots during startup recovery", () => {
    const referenced = ensureTempWorkspace(dataDir, "referenced");
    const orphan = ensureTempWorkspace(dataDir, "orphan");
    const nonempty = ensureTempWorkspace(dataDir, "nonempty");
    fs.writeFileSync(path.join(nonempty, "keep.txt"), "keep");
    const unrelated = path.join(dataDir, "workspaces", "manual-empty-folder");
    fs.mkdirSync(unrelated);
    const outside = path.join(dataDir, "outside");
    fs.mkdirSync(outside);
    const symlink = path.join(dataDir, "workspaces", "grok-symlink");
    fs.symlinkSync(outside, symlink, "dir");

    expect(
      cleanupEmptyOrphanWorkspaces({
        dataDir,
        referencedRoots: [referenced],
      }),
    ).toEqual([orphan]);
    expect(fs.existsSync(referenced)).toBe(true);
    expect(fs.readFileSync(path.join(nonempty, "keep.txt"), "utf8")).toBe("keep");
    expect(fs.existsSync(unrelated)).toBe(true);
    expect(fs.lstatSync(symlink).isSymbolicLink()).toBe(true);
  });

  it("does not traverse a symlinked workspaces base", () => {
    const base = path.join(dataDir, "workspaces");
    const outside = path.join(dataDir, "outside-base");
    fs.mkdirSync(outside);
    const externalCandidate = path.join(outside, "grok-orphan-ABC123");
    fs.mkdirSync(externalCandidate);
    fs.symlinkSync(outside, base, "dir");

    expect(
      cleanupEmptyOrphanWorkspaces({
        dataDir,
        referencedRoots: [],
      }),
    ).toEqual([]);
    expect(fs.existsSync(externalCandidate)).toBe(true);
  });
});
