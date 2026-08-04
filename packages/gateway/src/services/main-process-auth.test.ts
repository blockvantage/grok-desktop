import { describe, it, expect } from "vitest";
import {
  isMainProcessAuthMethod,
  mainProcessAuthErrorMessage,
  MAIN_PROCESS_AUTH_METHODS,
} from "./main-process-auth.js";

describe("main-process-auth", () => {
  it("flags SuperGrok main-only methods", () => {
    for (const m of MAIN_PROCESS_AUTH_METHODS) {
      expect(isMainProcessAuthMethod(m)).toBe(true);
    }
    expect(isMainProcessAuthMethod("auth.status")).toBe(false);
    expect(isMainProcessAuthMethod("tasks.create")).toBe(false);
  });

  it("builds rejection message", () => {
    expect(mainProcessAuthErrorMessage("auth.usage")).toContain(
      "desktop main process",
    );
    expect(mainProcessAuthErrorMessage("auth.usage")).toContain("auth.usage");
  });
});
