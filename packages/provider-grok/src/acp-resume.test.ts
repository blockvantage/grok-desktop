import { describe, expect, it } from "vitest";
import {
  acpResumeProgressMessage,
  chooseAcpResumePath,
  runningPromptIdFromLoadResult,
} from "./acp-resume.js";

describe("chooseAcpResumePath", () => {
  it("prefers session/resume, then load, then fresh-with-context", () => {
    expect(
      chooseAcpResumePath({
        sessionCapabilities: { resume: true, load: true },
        capabilities: { loadSession: true },
      }),
    ).toBe("resume");
    expect(
      chooseAcpResumePath({
        sessionCapabilities: { load: true },
      }),
    ).toBe("load");
    expect(
      chooseAcpResumePath({
        capabilities: { loadSession: true },
      }),
    ).toBe("load");
    expect(chooseAcpResumePath({})).toBe("fresh_with_context");
    expect(chooseAcpResumePath(null)).toBe("fresh_with_context");
  });

  it("emits a distinct progress message per path", () => {
    expect(acpResumeProgressMessage("resume")).toMatch(/Resumed/i);
    expect(acpResumeProgressMessage("load")).toMatch(/Loaded/i);
    expect(acpResumeProgressMessage("fresh_with_context")).toMatch(/new session/i);
  });

  it("reads runningPromptId from session/load _meta", () => {
    expect(
      runningPromptIdFromLoadResult({
        sessionId: "s1",
        _meta: { "x.ai/runningPromptId": "p-9" },
      }),
    ).toBe("p-9");
    expect(runningPromptIdFromLoadResult({ sessionId: "s1" })).toBeNull();
  });
});
