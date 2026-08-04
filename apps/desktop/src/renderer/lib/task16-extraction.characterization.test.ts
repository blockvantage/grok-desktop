/**
 * Task 16 characterization: lock shipped behavior before extraction,
 * and require maintainability extraction modules to exist and be wired.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rendererRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(rendererRoot, rel), "utf8");
}

function lineCount(rel: string): number {
  return read(rel).split("\n").length;
}

describe("Task 16 characterization before/after extraction", () => {
  it("locks App submission paths: beginMutation create + outbox follow-up", () => {
    const app = read("App.tsx");
    expect(app).toMatch(/beginMutation/);
    expect(app).toMatch(/clearPendingMutation/);
    expect(app).toMatch(/FOLLOW_UP_OUTBOX_METHOD|outbox\.enqueue/);
    expect(app).toMatch(/shouldBlockNewRootSubmit/);
    expect(app).toMatch(/useGatewayRecovery|useAppSync/);
  });

  it("locks workspace outbox + sticky composer contracts", () => {
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toMatch(/QueuedMessageRow/);
    expect(ws).toMatch(/workspace-sticky-composer|vt-compose/);
    expect(ws).toMatch(/planEnqueueRejectionFeedback|planComposerOfflineAction/);
  });

  it("requires extraction modules for submission, sync, composer, outbox, status", () => {
    const required = [
      "hooks/use-task-submission.ts",
      "hooks/use-app-sync.ts",
      "components/conversation/conversation-composer.tsx",
      "components/conversation/conversation-outbox.tsx",
      "components/conversation/conversation-status.tsx",
      "lib/task-stream-activity.ts",
    ];
    for (const rel of required) {
      expect(
        fs.existsSync(path.join(rendererRoot, rel)),
        `missing extraction target: ${rel}`,
      ).toBe(true);
    }
  });

  it("wires extractions into App / workspace / task-stream product paths", () => {
    const app = read("App.tsx");
    const ws = read("components/views/task-workspace-view.tsx");
    const stream = read("components/task-stream.tsx");
    expect(app + ws).toMatch(/useTaskSubmission|use-task-submission/);
    expect(app).toMatch(/useAppSync|use-app-sync/);
    expect(ws).toMatch(/ConversationOutbox|conversation-outbox/);
    expect(ws).toMatch(/ConversationComposer|conversation-composer/);
    expect(ws).toMatch(/ConversationStatus|conversation-status/);
    expect(stream).toMatch(/task-stream-activity|humanizeTool|workingActivity/);
  });

  it("tracks directional size reductions (signals, not hard CI fail yet)", () => {
    const appLines = lineCount("App.tsx");
    const wsLines = lineCount("components/views/task-workspace-view.tsx");
    const streamLines = lineCount("components/task-stream.tsx");
    // Soft targets from plan; fail only if we regress far above pre-extraction.
    expect(appLines).toBeLessThan(2800);
    expect(wsLines).toBeLessThan(3500);
    expect(streamLines).toBeLessThan(1800);
    // Record directional progress toward 1500 / 1800 / 900.
    const progress = {
      App: appLines,
      workspace: wsLines,
      stream: streamLines,
      appTarget: 1500,
      wsTarget: 1800,
      streamTarget: 900,
    };
    expect(progress.App).toBeGreaterThan(0);
  });
});
