import { describe, it, expect, vi } from "vitest";
import {
  dispatchWorkspaceMethod,
  isWorkspaceMethod,
} from "./workspace-dispatch.js";

describe("isWorkspaceMethod", () => {
  it("matches workspace.*", () => {
    expect(isWorkspaceMethod("workspace.readFile")).toBe(true);
    expect(isWorkspaceMethod("tasks.list")).toBe(false);
  });
});

describe("dispatchWorkspaceMethod", () => {
  it("ensureTemp uses label default", () => {
    const ensureTemp = vi.fn((label: string) => ({ path: `/ws/${label}` }));
    const deps = {
      ensureTemp,
      listFiles: vi.fn(),
      readFile: vi.fn(),
      readAsset: vi.fn(),
      prepareAsset: vi.fn(),
    };
    expect(dispatchWorkspaceMethod("workspace.ensureTemp", {}, deps)).toEqual({
      path: "/ws/chat",
    });
    expect(ensureTemp).toHaveBeenCalledWith("chat");
  });

  it("readAsset passes optional root", () => {
    const readAsset = vi.fn(() => ({ ok: true }));
    const deps = {
      ensureTemp: vi.fn(),
      listFiles: vi.fn(),
      readFile: vi.fn(),
      readAsset,
      prepareAsset: vi.fn(),
    };
    dispatchWorkspaceMethod(
      "workspace.readAsset",
      { path: "a.png", root: "/ws", maxBytes: 1000 },
      deps,
    );
    expect(readAsset).toHaveBeenCalledWith("a.png", 1000, "/ws");
  });
});
