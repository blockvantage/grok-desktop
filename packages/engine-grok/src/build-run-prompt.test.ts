import { describe, it, expect } from "vitest";
import type { Task } from "@grokdesk/shared";
import { buildRunPrompt } from "./session.js";

const baseTask = {
  id: "t1",
  goal: "summarize notes",
  title: null,
  mode: "interactive" as const,
  status: "running" as const,
  model: "grok-4.5",
  effort: "normal" as const,
  policySnapshot: {
    approvalMode: "balanced" as const,
    workspaceRoots: ["/ws"],
    allowNetworkTools: true,
    allowShell: false,
  },
  projectId: null,
  parentTaskId: null,
  revisionOfTaskId: null,
  scheduleRuleId: null,
  rolePack: null,
  skills: [],
  mcpServerIds: [],
  createdAt: "2026-07-17T00:00:00Z",
  updatedAt: "2026-07-17T00:00:00Z",
  completedAt: null,
} satisfies Task;

function buildPromptForTest(task: Task): string {
  return buildRunPrompt({
    task,
    systemPreamble: "",
    extras: "",
    primaryCwd: "/ws",
  });
}

describe("buildRunPrompt reply language (LANG-1)", () => {
  it("adds a reply-language instruction for German (de)", () => {
    const prompt = buildPromptForTest({ ...baseTask, locale: "de" });
    expect(prompt).toContain(
      "Reply to the user in German unless they clearly write in a different language.",
    );
  });

  it("adds a reply-language instruction for Japanese (ja)", () => {
    const prompt = buildPromptForTest({ ...baseTask, locale: "ja" });
    expect(prompt).toContain(
      "Reply to the user in Japanese unless they clearly write in a different language.",
    );
  });

  it("maps remaining non-English locales", () => {
    expect(buildPromptForTest({ ...baseTask, locale: "es" })).toContain(
      "Reply to the user in Spanish",
    );
    expect(buildPromptForTest({ ...baseTask, locale: "fr" })).toContain(
      "Reply to the user in French",
    );
    expect(buildPromptForTest({ ...baseTask, locale: "pt" })).toContain(
      "Reply to the user in Portuguese",
    );
    expect(buildPromptForTest({ ...baseTask, locale: "zh" })).toContain(
      "Reply to the user in Chinese (Simplified)",
    );
  });

  it("omits the language line for en", () => {
    expect(buildPromptForTest({ ...baseTask, locale: "en" })).not.toContain(
      "Reply to the user in",
    );
  });

  it("omits the language line when locale is undefined", () => {
    expect(buildPromptForTest(baseTask)).not.toContain("Reply to the user in");
  });
});
