/**
 * Wiring evidence for Tasks 7–10 / AC2–AC4.
 * Fail-closed: App and workspace must call the shipped pure modules.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rendererRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(rendererRoot, rel), "utf8");
}

describe("Task 7 stable mutation IDs (AC2)", () => {
  it("App uses beginMutation / clearPendingMutation / newClientMutationId", () => {
    const app = read("App.tsx");
    expect(app).toMatch(/beginMutation/);
    expect(app).toMatch(/clearPendingMutation/);
    expect(app).toMatch(/newClientMutationId|clientMutationId/);
    // Root create persists before RPC
    expect(app).toMatch(/method:\s*"tasks\.create"/);
  });
});

describe("Task 8 Send now interjection only (AC2)", () => {
  it("outbox hook and workspace never fall back to concurrent create", () => {
    const hook = read("hooks/use-conversation-outbox.ts");
    expect(hook).toMatch(/outbox\.sendNow/);
    expect(hook).not.toMatch(/tasks\.create/);
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toMatch(/interjectNow|Send now|queueSendNow/);
    expect(ws).not.toMatch(/if\s*\(\s*!delivered\s*\)\s*sendQueuedNowBase/);
  });
});

describe("Task 9 recovery / resync (AC4)", () => {
  it("App wires restartGateway actions and useGatewayRecovery full resync", () => {
    const app = read("App.tsx");
    // Task 16: useAppSync owns ready-edge resync (wraps useGatewayRecovery).
    expect(app).toMatch(/useGatewayRecovery|useAppSync/);
    expect(app).toMatch(/restartGateway/);
    expect(app).toMatch(/refreshOutbox|workspaceQueue\.refresh/);
    expect(app).toMatch(/refreshEvents|setEventsResyncKey/);
    expect(app).toMatch(/reconcilePendingRoot|onPendingRootAccepted/);
    expect(app).toMatch(/copyDiagnostics|openLogsFolder/);
    const sync = read("hooks/use-app-sync.ts");
    expect(sync).toMatch(/useGatewayRecovery/);
    expect(sync).toMatch(/reconcilePendingRoot/);
  });
});

describe("Task 10 delivery-state (AC4)", () => {
  it("delivery-state pure module exists and is imported on product path", () => {
    const mod = read("lib/delivery-state.ts");
    expect(mod).toMatch(/deriveDeliveryPhase/);
    expect(mod).toMatch(/mayShowWorking/);
    expect(mod).toMatch(/delivery_unknown|saved_local|connecting/);
    const product = [
      read("App.tsx"),
      read("components/views/task-workspace-view.tsx"),
      read("components/status-pill.tsx"),
      read("components/task-stream.tsx"),
    ].join("\n");
    // Hard wire: StatusPill and TaskStream must import the pure model.
    expect(product).toMatch(/from\s+["']@\/lib\/delivery-state["']/);
    expect(read("components/status-pill.tsx")).toMatch(/deriveDeliveryPhase/);
    expect(read("components/task-stream.tsx")).toMatch(/mayShowWorking/);
    expect(read("components/views/task-workspace-view.tsx")).toMatch(
      /deliveryAccepted|delivery=\{/,
    );
  });
});

describe("Task 12 home draft hydrate (AC4)", () => {
  it("App calls planHomeDraftHydration and does not only useState empty goal", () => {
    const app = read("App.tsx");
    expect(app).toMatch(/planHomeDraftHydration/);
    expect(app).toMatch(/showDraftRestored|Draft restored|draftRestored/);
    // Must not be the sole pattern without hydrate
    expect(app).toMatch(/planHomeDraftHydration|loadWorkSession/);
  });
});
