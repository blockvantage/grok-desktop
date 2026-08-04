import { describe, expect, it } from "vitest";
import {
  humanizeTool,
  toolIconKind,
  workingActivity,
} from "./task-stream-activity";

const tr = (k: string) => k;

describe("task-stream-activity (Task 16 extract)", () => {
  it("humanizes common tools", () => {
    expect(humanizeTool("read_file", tr)).toBe("activity.reading");
    expect(humanizeTool("browser_open", tr)).toBe("activity.openingPage");
    expect(humanizeTool("run_shell", tr)).toBe("activity.runningCommand");
  });

  it("prefers a running tool over a later thought for activity", () => {
    const a = workingActivity(
      { kind: "thought" },
      tr,
      [
        {
          kind: "toolAction",
          tool: "read_file",
          detail: "a.ts",
          status: "running",
        },
        { kind: "thought" },
      ],
    );
    expect(a.generic).toBe(false);
    expect(a.label).toBe("activity.reading");
    expect(a.detail).toBe("a.ts");
  });

  it("maps tool icons without pulling lucide into pure module", () => {
    expect(toolIconKind("browser_click")).toBe("globe");
    expect(toolIconKind("write_file")).toBe("file");
    expect(toolIconKind("delete_file")).toBe("trash");
    expect(toolIconKind("shell")).toBe("terminal");
  });
});
