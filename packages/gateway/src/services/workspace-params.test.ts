import { describe, it, expect } from "vitest";
import {
  optionalWorkspaceRoot,
  ensureTempWorkspaceLabel,
} from "./workspace-params.js";

describe("optionalWorkspaceRoot", () => {
  it("string only", () => {
    expect(optionalWorkspaceRoot({ root: "/ws" })).toBe("/ws");
    expect(optionalWorkspaceRoot({ root: "" })).toBeUndefined();
    expect(optionalWorkspaceRoot({})).toBeUndefined();
    expect(optionalWorkspaceRoot({ root: 1 })).toBeUndefined();
  });
});

describe("ensureTempWorkspaceLabel", () => {
  it("defaults to chat", () => {
    expect(ensureTempWorkspaceLabel({})).toBe("chat");
    expect(ensureTempWorkspaceLabel({ label: "  " })).toBe("chat");
    expect(ensureTempWorkspaceLabel({ label: "task" })).toBe("task");
  });
});
