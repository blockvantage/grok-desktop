import { describe, it, expect } from "vitest";
import {
  DEFAULT_WORKSPACE_LIST_MAX,
  workspaceAssetMaxBytes,
  workspaceListMax,
  workspacePrepareMaxBytes,
  workspaceReadMaxChars,
} from "./workspace-ipc-defaults.js";

describe("workspace-ipc-defaults", () => {
  it("uses defaults for missing/invalid", () => {
    expect(workspaceListMax()).toBe(DEFAULT_WORKSPACE_LIST_MAX);
    expect(workspaceListMax(-1)).toBe(DEFAULT_WORKSPACE_LIST_MAX);
    expect(workspaceReadMaxChars(undefined)).toBe(80_000);
    expect(workspaceAssetMaxBytes(0)).toBe(64 * 1024 * 1024);
  });

  it("accepts positive finite overrides", () => {
    expect(workspaceListMax(10)).toBe(10);
    expect(workspaceReadMaxChars(1000.9)).toBe(1000);
    expect(workspaceAssetMaxBytes(1024)).toBe(1024);
    expect(workspacePrepareMaxBytes(2048)).toBe(2048);
  });
});
