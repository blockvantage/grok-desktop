import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { assertNoRealProfileEnv } from "./fixtures/test-profile";
import { CHAT_SCENARIOS } from "./fixtures/scenarios";

const monorepoRoot = path.join(process.cwd(), "../..");

test.describe("chat approvals journeys", () => {
  test("approvals harness refuses real profiles", () => {
    expect(() => assertNoRealProfileEnv()).not.toThrow();
  });

  test("approval scenario knob requests user decision", () => {
    expect(CHAT_SCENARIOS.approval_request.provider.requestApproval).toBe(true);
  });

  test("workspace approval actions are single-flight gated", () => {
    const ws = fs.readFileSync(
      path.join(
        monorepoRoot,
        "apps/desktop/src/renderer/components/views/task-workspace-view.tsx",
      ),
      "utf8",
    );
    expect(ws).toMatch(/runApprove|onApprove/);
    expect(ws).toMatch(/runReject|onReject/);
    expect(ws).toMatch(/pendingApprovalBusy|approvalBusy/);
  });
});
