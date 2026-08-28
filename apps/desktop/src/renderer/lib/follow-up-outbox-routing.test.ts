/**
 * Structural proof: every follow-up entry point in the workspace routes
 * through outbox.enqueue (or buildOutboxFollowUpParams), never a parallel
 * tasks.create acceptance path for follow-ups.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOutboxFollowUpParams,
  FOLLOW_UP_OUTBOX_METHOD,
} from "./outbox-follow-up";

const rendererRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(rendererRoot, rel), "utf8");
}

describe("follow-up outbox routing (AC1)", () => {
  it("App.followUpTask uses outbox.enqueue, not tasks.create", () => {
    const app = read("App.tsx");
    // Task 16: follow-up body may delegate to useTaskSubmission extract.
    expect(app).toMatch(/useTaskSubmission|FOLLOW_UP_OUTBOX_METHOD|outbox\.enqueue/);
    const submit = read("hooks/use-task-submission.ts");
    expect(submit).toMatch(/FOLLOW_UP_OUTBOX_METHOD|outbox\.enqueue/);
    expect(submit).toMatch(/buildOutboxFollowUpParams/);
    // followUpTask callback must not call tasks.create (root create may).
    const followIdx = submit.indexOf("const followUpTask = useCallback");
    expect(followIdx).toBeGreaterThan(-1);
    const followBody = submit.slice(followIdx, followIdx + 1_800);
    expect(followBody).toMatch(/FOLLOW_UP_OUTBOX_METHOD|outbox\.enqueue/);
    expect(followBody).not.toMatch(/"tasks\.create"/);
    // Thin App wrapper must not create follow-ups via tasks.create.
    const idx = app.indexOf("async function followUpTask");
    expect(idx).toBeGreaterThan(-1);
    const followUpFn = app.slice(idx, idx + 800);
    expect(followUpFn).toMatch(/submitFollowUp|useTaskSubmission/);
    expect(followUpFn).not.toMatch(/"tasks\.create"/);
  });

  it("workspace chips/retry/answer/revision still invoke onFollowUp (now outbox-backed)", () => {
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toMatch(/onAnswerQuestion/);
    expect(ws).toMatch(/onRetryConversationTurn/);
    expect(ws).toMatch(/onRecoveryAction/);
    expect(ws).toMatch(/props\.onFollowUp/);
    expect(ws).toMatch(/enqueueAsync/);
    expect(ws).toMatch(/weaveFollowUpComposerGoal/);
  });

  it("composer and chip entry points share buildOutboxFollowUpParams", () => {
    for (const entryPoint of [
      "composer",
      "answer_question",
      "turn_retry",
      "recovery_retry",
      "post_run_chip",
      "revision",
    ] as const) {
      const p = buildOutboxFollowUpParams({
        conversationId: "c",
        parentTaskId: "t",
        text: "x",
        clientMutationId: `m-${entryPoint}`,
        entryPoint,
        revisionOfTaskId:
          entryPoint === "revision" ? "source" : undefined,
      });
      expect(FOLLOW_UP_OUTBOX_METHOD).toBe("outbox.enqueue");
      expect(p.id).toBe(`m-${entryPoint}`);
      if (entryPoint === "revision") {
        expect(p.revisionOfTaskId).toBe("source");
      }
    }
  });

  it("use-chat-events pages via events.page not events.list", () => {
    const src = read("hooks/use-chat-events.ts");
    expect(src).toMatch(/events\.page/);
    expect(src).not.toMatch(/"events\.list"/);
    expect(src).toMatch(/hasMore|truncated|staleSince/);
  });

  it("use-conversation-outbox does not clear items when gateway not ready", () => {
    const src = read("hooks/use-conversation-outbox.ts");
    // Must not blank projection solely because ready===false.
    expect(src).toMatch(/While reconnecting|gatewayReady === false/);
    expect(src).not.toMatch(
      /if \(!conversationId \|\| opts\.gatewayReady === false\) \{\s*setItems\(\[\]\)/,
    );
  });
});
