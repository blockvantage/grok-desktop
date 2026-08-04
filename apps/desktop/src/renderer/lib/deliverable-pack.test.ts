import { describe, expect, it } from "vitest";
import {
  lastAssistantText,
  planDeliverablePack,
} from "./deliverable-pack";

describe("deliverable-pack", () => {
  it("extracts last assistant text", () => {
    expect(
      lastAssistantText([
        { role: "user", text: "hi" },
        { role: "assistant", text: "first" },
        { role: "assistant", text: "final answer" },
      ]),
    ).toBe("final answer");
  });

  it("plans index + answer + artifact files", () => {
    const plan = planDeliverablePack({
      chatTitle: "Q3 Launch Brief!",
      taskId: "task_1",
      now: new Date("2026-07-15T12:00:00.000Z"),
      messages: [
        { role: "user", text: "Write a brief" },
        { role: "assistant", text: "# Brief\n\nAudience: founders" },
      ],
      artifacts: [
        { id: "a1", title: "brief.md", path: "/Users/me/brief.md" },
        { id: "a2", path: "/Users/me/chart.png" },
      ],
    });

    expect(plan.packName).toMatch(/q3-launch-brief/);
    expect(plan.hasAnswer).toBe(true);
    expect(plan.artifactCount).toBe(2);
    expect(plan.files.some((f) => f.relPath === "INDEX.md")).toBe(true);
    expect(plan.files.some((f) => f.relPath === "answer.md")).toBe(true);
    expect(plan.files.some((f) => f.kind === "artifact" && f.sourcePath?.endsWith("brief.md"))).toBe(
      true,
    );
    expect(plan.summary).toMatch(/answer/i);
    const answer = plan.files.find((f) => f.relPath === "answer.md");
    expect(answer?.content).toContain("Audience: founders");
  });

  it("still produces index when empty", () => {
    const plan = planDeliverablePack({
      chatTitle: "Empty",
      taskId: "t",
      messages: [],
      artifacts: [],
    });
    expect(plan.hasAnswer).toBe(false);
    expect(plan.files.some((f) => f.relPath === "meta.json")).toBe(true);
  });
});
