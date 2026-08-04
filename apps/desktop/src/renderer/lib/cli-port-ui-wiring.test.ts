/**
 * Structural checks: Phase B/C UI affordances are mounted on the real product path.
 * (Avoids flaky Electron E2E while still failing if wiring is dropped.)
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("CLI port UI wiring (structural)", () => {
  it("home composer exposes Draft a plan first toggle", () => {
    const home = read("components/views/home-view.tsx");
    expect(home).toContain("home.planFirstToggle");
    expect(home).toContain("data-plan-first-toggle");
    expect(home).toContain("onPlanFirst");
  });

  it("create-task params thread planFirst into tasks.create", () => {
    const optimistic = read("lib/create-task-optimistic.ts");
    expect(optimistic).toContain("planFirst");
    expect(optimistic).toMatch(/planFirst:\s*true/);
    const form = read("lib/create-task-form.ts");
    expect(form).toContain("planFirst");
  });

  it("workspace mounts ContextMeter and calls context/compact RPCs", () => {
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toContain("ContextMeter");
    expect(ws).toContain("taskContextUsage");
    expect(ws).toContain("taskCompact");
  });

  it("api exposes interject, rewind, context, compact RPC helpers", () => {
    const api = read("lib/api.ts");
    expect(api).toContain('task.interject');
    expect(api).toContain("clientMutationId");
    expect(api).toContain('task.rewindPoints');
    expect(api).toContain('task.rewind');
    expect(api).toContain('task.contextUsage');
    expect(api).toContain('task.compact');
  });

  it("queue supports mid-run interjectNow with mutation id", () => {
    const q = read("hooks/use-workspace-queue.ts");
    expect(q).toContain("interjectNow");
    expect(q).toContain("onInterject");
    expect(q).toContain("clientMutationId");
  });

  it("conversation turn exposes Undo this turn when onUndoTurn is set", () => {
    const turn = read("components/conversation/conversation-turn.tsx");
    expect(turn).toContain("onUndoTurn");
    expect(turn).toContain("conversation.undoTurn");
    expect(turn).toContain("data-undo-turn");
  });

  it("task stream/workspace wire onUndoTurn to rewind RPCs with turn mapping", () => {
    const stream = read("components/task-stream.tsx");
    expect(stream).toContain("onUndoTurn");
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toContain("taskRewindPoints");
    expect(ws).toContain("taskRewind");
    expect(ws).toContain("onUndoTurn");
    expect(ws).toContain("mapTurnToRewindPoint");
    expect(ws).toMatch(/taskRewind\(\s*turn\.taskId,\s*point\.id,\s*turn\.id/);
  });
});
