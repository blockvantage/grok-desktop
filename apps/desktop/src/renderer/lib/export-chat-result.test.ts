import { describe, it, expect } from "vitest";
import {
  exportChatSuccessIntent,
  exportChatErrorIntent,
  imagineGoalFromTask,
} from "./export-chat-result";

describe("exportChatSuccessIntent", () => {
  it("returns success with path", () => {
    expect(exportChatSuccessIntent("/tmp/out.md")).toEqual({
      kind: "success",
      path: "/tmp/out.md",
    });
  });
});

describe("exportChatErrorIntent", () => {
  it("uses Error message", () => {
    expect(exportChatErrorIntent(new Error("boom"), "fallback")).toEqual({
      kind: "error",
      message: "boom",
    });
  });

  it("falls back for non-Error", () => {
    expect(exportChatErrorIntent("x", "fallback")).toEqual({
      kind: "error",
      message: "fallback",
    });
  });
});

describe("imagineGoalFromTask", () => {
  it("templates goal", () => {
    expect(imagineGoalFromTask("a robot")).toContain("a robot");
    expect(imagineGoalFromTask("a robot")).toContain("./artifacts");
  });
});
