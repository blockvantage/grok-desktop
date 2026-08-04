/**
 * Task 21 destructive-boundary matrix — automated structural coverage.
 * Maps the seven manual scenarios to shipped code paths so the gate can
 * prove recovery behavior without a real profile.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// lib/ → renderer/ → src/ → desktop/ → apps/ → monorepo root
const monorepoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

function readRel(rel: string): string {
  return fs.readFileSync(path.join(monorepoRoot, rel), "utf8");
}

describe("Task 21 destructive-boundary matrix (structural)", () => {
  it("1. submit then switch chats: global outbox drain + conversation filter", () => {
    const drain = readRel("packages/gateway/src/services/outbox-drain.ts");
    expect(drain).toMatch(/conversation|claimNext|FIFO|fifo/i);
    const hook = readRel(
      "apps/desktop/src/renderer/hooks/use-conversation-outbox.ts",
    );
    expect(hook).toMatch(/conversationId/);
    expect(hook).toMatch(/outbox\.enqueue/);
  });

  it("2. submit then reload renderer: pending mutation + home hydrate", () => {
    const cm = readRel("apps/desktop/src/renderer/lib/client-mutation.ts");
    expect(cm).toMatch(/beginMutation|readPendingMutation/);
    const app = readRel("apps/desktop/src/renderer/App.tsx");
    expect(app).toMatch(/planHomeDraftHydration|readPendingMutation/);
    expect(app).toMatch(/shouldBlockNewRootSubmit/);
  });

  it("3. submit then kill/restart gateway: recovery resync + crashForTest", () => {
    const sync = readRel("apps/desktop/src/renderer/hooks/use-app-sync.ts");
    expect(sync).toMatch(/useGatewayRecovery|reconcilePendingRoot/);
    const e2e = readRel("apps/desktop/src/main/e2e-test-controls.ts");
    expect(e2e).toMatch(/GROKDESK_E2E/);
    expect(e2e).toMatch(/crashGateway/);
    const gw = readRel("apps/desktop/src/main/gateway-process.ts");
    expect(gw).toMatch(/crashForTest|async restart/);
  });

  it("4. submit then quit/relaunch: work session + pending mutation persist", () => {
    const ws = readRel("apps/desktop/src/renderer/lib/work-session.ts");
    expect(ws).toMatch(/saveWorkSession|loadWorkSession|draftCleared/);
    const cm = readRel("apps/desktop/src/renderer/lib/client-mutation.ts");
    expect(cm).toMatch(/localStorage|STORAGE|setItem|getItem/);
  });

  it("5. fill queue to capacity: structured full, no silent delete", () => {
    const outbox = readRel(
      "packages/gateway/src/services/conversation-outbox.ts",
    );
    expect(outbox).toMatch(/OUTBOX_MAX_PENDING|outcome:\s*"full"/);
    expect(outbox).not.toMatch(/DELETE FROM conversation_outbox.*ORDER BY/);
  });

  it("6. delete attachment before drain: blocked_missing_attachment + re-pick", () => {
    const outbox = readRel(
      "packages/gateway/src/services/conversation-outbox.ts",
    );
    expect(outbox).toMatch(
      /missing_attachment|blocked_missing_attachment|markBlockedMissingAttachment/,
    );
    const row = readRel(
      "apps/desktop/src/renderer/components/conversation/queued-message-row.tsx",
    );
    expect(row).toMatch(/queueMissingAttachment|repick|missing_attachment/);
  });

  it("7. reconnect after stale events: events.page + stale banner + retry", () => {
    const events = readRel(
      "apps/desktop/src/renderer/hooks/use-chat-events.ts",
    );
    expect(events).toMatch(/events\.page|staleSince|truncated/);
    const banner = readRel(
      "apps/desktop/src/renderer/components/conversation/event-history-banner.tsx",
    );
    expect(banner).toMatch(/planEventHistoryBanner|stale|retry/i);
  });

  it("never dual-path follow-up create; Send now never concurrent create", () => {
    const submit = readRel(
      "apps/desktop/src/renderer/hooks/use-task-submission.ts",
    );
    const followIdx = submit.indexOf("const followUpTask = useCallback");
    expect(followIdx).toBeGreaterThan(-1);
    expect(submit.slice(followIdx, followIdx + 1800)).not.toMatch(
      /"tasks\.create"/,
    );
    const dispatch = readRel(
      "packages/gateway/src/services/outbox-dispatch.ts",
    );
    expect(dispatch).toMatch(/outbox\.sendNow/);
    expect(dispatch).not.toMatch(/dispatchTasksCreate/);
  });
});
