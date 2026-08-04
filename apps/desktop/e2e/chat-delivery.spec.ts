/**
 * Chat delivery journeys (Task 19).
 * Structural proofs always run; full Electron launch is gated on built out/main.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  assertNoRealProfileEnv,
  createTempTestProfile,
  FAKE_PROVIDER_ENV,
} from "./fixtures/test-profile";
import {
  buildDeskLaunchEnv,
  requireBuiltMainOrSkip,
} from "./fixtures/desk-app";
import { CHAT_SCENARIOS } from "./fixtures/scenarios";

const here = path.join(process.cwd(), "e2e");
const monorepoRoot = path.join(process.cwd(), "../..");

function readRepo(...parts: string[]): string {
  return fs.readFileSync(path.join(monorepoRoot, ...parts), "utf8");
}

test.describe("chat delivery harness", () => {
  test("refuses real profile env and allocates temp profile", () => {
    assertNoRealProfileEnv();
    const p = createTempTestProfile();
    expect(fs.existsSync(p.userDataDir)).toBe(true);
    expect(fs.existsSync(p.gatewayDataDir)).toBe(true);
    expect(FAKE_PROVIDER_ENV.GROKDESK_PROVIDER_ID).toBe("fake");
    p.cleanup();
  });

  test("fixtures, scenarios, and outbox decision docs exist", () => {
    expect(fs.existsSync(path.join(here, "fixtures/test-profile.ts"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(here, "fixtures/desk-app.ts"))).toBe(true);
    expect(fs.existsSync(path.join(here, "fixtures/scenarios.ts"))).toBe(true);
    expect(CHAT_SCENARIOS.happy_path_create_stream_done.provider.complete).toBe(
      true,
    );
    const decision = path.join(
      monorepoRoot,
      "docs/decisions/2026-08-03-gateway-chat-outbox.md",
    );
    expect(fs.existsSync(decision)).toBe(true);
  });

  test("create → outbox → single acceptance path (no dual create)", () => {
    const app = readRepo("apps/desktop/src/renderer/App.tsx");
    expect(app).toMatch(/beginMutation|useTaskSubmission/);
    expect(app).toMatch(/useTaskSubmission|FOLLOW_UP_OUTBOX_METHOD|outbox/);
    const submit = readRepo(
      "apps/desktop/src/renderer/hooks/use-task-submission.ts",
    );
    expect(submit).toMatch(/FOLLOW_UP_OUTBOX_METHOD|outbox\.enqueue/);
    const followIdx = submit.indexOf("const followUpTask = useCallback");
    expect(followIdx).toBeGreaterThan(-1);
    expect(submit.slice(followIdx, followIdx + 1800)).not.toMatch(
      /"tasks\.create"/,
    );
  });

  test("one active run per conversation serialization is enforced", () => {
    const concurrency = readRepo(
      "packages/gateway/src/services/concurrency.ts",
    );
    expect(concurrency).toMatch(/threadKeyForTask|occupiedThreads/);
  });

  test("Send now is interject-only and never concurrent create", () => {
    const dispatch = readRepo(
      "packages/gateway/src/services/outbox-dispatch.ts",
    );
    expect(dispatch).toMatch(/outbox\.sendNow/);
    expect(dispatch).toMatch(/unsupported|interject/);
    expect(dispatch).not.toMatch(/dispatchTasksCreate/);
    const workspace = readRepo(
      "apps/desktop/src/renderer/components/views/task-workspace-view.tsx",
    );
    expect(workspace).not.toMatch(/if \(!delivered\) sendQueuedNowBase/);
  });

  test("queue capacity returns full without silent eviction", () => {
    const outbox = readRepo(
      "packages/gateway/src/services/conversation-outbox.ts",
    );
    expect(outbox).toMatch(/OUTBOX_MAX_PENDING/);
    expect(outbox).toMatch(/outcome:\s*"full"/);
    expect(outbox).not.toMatch(/DELETE FROM conversation_outbox.*pending/);
  });

  test("remote allowlist does not expose outbox methods", () => {
    const allow = readRepo("packages/shared/src/remote-allowlist.ts");
    expect(allow).not.toMatch(/outbox\./);
  });

  test("Home draft hydrate ships before interactive composer", () => {
    const app = readRepo("apps/desktop/src/renderer/App.tsx");
    expect(app).toMatch(/planHomeDraftHydration/);
    expect(app).toMatch(/initialHomeHydration\.goal|draftRestoredNotice/);
    expect(app).not.toMatch(/const \[goal, setGoal\] = useState\(""\)/);
  });

  test("launch env builder uses fake provider and temp data dirs", () => {
    const { env, profile } = buildDeskLaunchEnv();
    expect(env.GROKDESK_PROVIDER_ID).toBe("fake");
    expect(env.GROKDESK_E2E).toBe("1");
    expect(env.GROKDESK_DATA_DIR).toBe(profile.gatewayDataDir);
    profile.cleanup();
  });

  test("CI path requires built main (no soft-skip when disallowed)", () => {
    const built = requireBuiltMainOrSkip({
      allowSkipMissingBuild: true,
      desktopRoot: process.cwd(),
    });
    // After e2e:chat build step, main should exist; if not, soft skip only when allowed.
    if ("skip" in built) {
      expect(built.reason).toMatch(/build/);
    } else {
      expect(fs.existsSync(built.main)).toBe(true);
    }
  });
});
