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

describe("buildRunPrompt intent-aware guidance", () => {
  it("answers conversational questions without manufacturing deliverables", () => {
    const prompt = buildPromptForTest({
      ...baseTask,
      goal: "Why is the sky blue?",
    });

    expect(prompt).toContain("Answer conversational questions directly");
    expect(prompt).not.toContain("write deliverables here");
    expect(prompt).not.toContain("List the tool path");
    expect(prompt).not.toContain("always write");
  });

  it.each([
    "How should I fix this?",
    "Can you explain how React updates state?",
    "What should I update in this configuration?",
    "Please explain how to fix this error",
    "Show me how to build a React app",
  ])("keeps explanatory code questions conversational: %s", (goal) => {
    const prompt = buildPromptForTest({ ...baseTask, goal });

    expect(prompt).not.toContain("Create the requested deliverables");
  });

  it("still recognizes an explicit code-change request", () => {
    const prompt = buildPromptForTest({
      ...baseTask,
      goal: "Fix the broken state update in src/App.tsx",
    });

    expect(prompt).toContain("Create the requested deliverables");
  });

  it("adds focused file and preview guidance for a website deliverable", () => {
    const prompt = buildPromptForTest({
      ...baseTask,
      goal: "Build a polished landing page in HTML and preview it",
    });

    expect(prompt).toContain("Create the requested deliverables");
    expect(prompt).toContain("write it under the primary workspace");
    expect(prompt).toContain("browser_open");
    expect(prompt).not.toContain("image_gen / image_edit / image_to_video");
  });

  it("asks current research to cite direct web sources without media noise", () => {
    const prompt = buildPromptForTest({
      ...baseTask,
      goal: "Research the latest Electron security guidance",
    });

    expect(prompt).toContain("cite the sources");
    expect(prompt).toContain("direct HTTP(S) links");
    expect(prompt).not.toContain("image_gen / image_edit / image_to_video");
  });

  it("keeps generation-tool guidance for explicit media requests", () => {
    const prompt = buildPromptForTest({
      ...baseTask,
      goal: "Generate an image of a quiet mountain observatory",
    });

    expect(prompt).toContain("image_gen / image_edit / image_to_video");
    expect(prompt).toContain("intended workspace path");
  });
});
