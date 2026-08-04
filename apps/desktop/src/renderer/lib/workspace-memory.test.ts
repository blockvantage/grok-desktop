import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  LAST_WORKSPACE_KEY,
  readLastWorkspaceRoot,
  resolveInitialWorkspaceRoot,
  writeLastWorkspaceRoot,
} from "./workspace-memory";

describe("workspace-memory", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips last workspace root", () => {
    expect(readLastWorkspaceRoot()).toBeNull();
    writeLastWorkspaceRoot("/Users/me/project");
    expect(readLastWorkspaceRoot()).toBe("/Users/me/project");
    expect(store.get(LAST_WORKSPACE_KEY)).toBe("/Users/me/project");
    writeLastWorkspaceRoot("  ");
    expect(readLastWorkspaceRoot()).toBeNull();
  });

  it("resolveInitialWorkspaceRoot prefers explicit, then last, then task roots", () => {
    expect(
      resolveInitialWorkspaceRoot({
        explicit: "/a",
        lastUsed: "/b",
        taskRoots: ["/c"],
      }),
    ).toBe("/a");
    expect(
      resolveInitialWorkspaceRoot({
        explicit: "",
        lastUsed: "/b",
        taskRoots: ["/c"],
      }),
    ).toBe("/b");
    expect(
      resolveInitialWorkspaceRoot({
        lastUsed: null,
        taskRoots: ["", "  ", "/c"],
      }),
    ).toBe("/c");
    expect(resolveInitialWorkspaceRoot({})).toBe("");
  });

  it("never persists or restores managed GrokDesk workspace paths", () => {
    const managed =
      "/Users/me/Library/Application Support/GrokDesk/workspaces/grok-chat-abc";
    writeLastWorkspaceRoot(managed);
    expect(readLastWorkspaceRoot()).toBeNull();
    expect(
      resolveInitialWorkspaceRoot({
        explicit: managed,
        lastUsed: managed,
        taskRoots: [managed, "/Users/me/real"],
      }),
    ).toBe("/Users/me/real");
  });
});
