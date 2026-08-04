/**
 * Structural + pure-model proof that AC4 recovery chrome is shipped and wired.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planEventHistoryBanner } from "@/lib/event-history-status";

const rendererRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(rendererRoot, rel), "utf8");
}

describe("event-history-banner wiring (AC4 visibility)", () => {
  it("ships a banner component with retry test id", () => {
    const src = read("components/conversation/event-history-banner.tsx");
    expect(src).toMatch(/data-testid=\{banner\.testId\}/);
    expect(src).toMatch(/event-history-retry/);
    expect(src).toMatch(/planEventHistoryBanner/);
    // Kinds come from the pure planner (not hard-coded only in the component).
    expect(planEventHistoryBanner({ error: "e", staleSince: "t", truncated: false }).testId).toBe(
      "event-history-stale",
    );
    expect(
      planEventHistoryBanner({ error: null, staleSince: null, truncated: true }).testId,
    ).toBe("event-history-truncated");
  });

  it("TaskWorkspaceView accepts and renders events recovery props", () => {
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toMatch(/eventsError/);
    expect(ws).toMatch(/eventsStaleSince/);
    expect(ws).toMatch(/eventsTruncated/);
    expect(ws).toMatch(/onRetryEvents/);
    expect(ws).toMatch(/EventHistoryBanner/);
  });

  it("App passes useChatEvents recovery fields into the workspace", () => {
    const app = read("App.tsx");
    expect(app).toMatch(/error:\s*eventsError|eventsError/);
    expect(app).toMatch(/staleSince:\s*eventsStaleSince|eventsStaleSince/);
    expect(app).toMatch(/truncated:\s*eventsTruncated|eventsTruncated/);
    expect(app).toMatch(/onRetryEvents=\{retryChatEvents\}/);
  });

  it("planEventHistoryBanner is the single source of banner kind", () => {
    const banner = planEventHistoryBanner({
      error: "fail",
      staleSince: "t",
      truncated: false,
    });
    expect(banner.testId).toBe("event-history-stale");
    expect(banner.showRetry).toBe(true);
  });
});
