import { defineConfig } from "@playwright/test";

/**
 * Electron visual/smoke/chat E2E — not wired into monorepo `pnpm -r test`.
 *
 * Deterministic harness (Task 18):
 *   - Fresh temp userData + gateway data via fixtures/test-profile.ts
 *   - GROKDESK_PROVIDER_ENGINE=1 + GROKDESK_PROVIDER_ID=fake
 *   - GROKDESK_E2E=1 enables privileged crash/fault IPC (main only)
 *
 * Soft-skip matrix (local only):
 *   smoke / account / browser / visual-qa — need built out/main
 * CI e2e:chat must build first and fail (not soft-skip) when Electron cannot launch.
 *
 * Run:
 *   export GROKDESK_NODE_PATH="$(which node)"
 *   pnpm --filter @grokdesk/desktop build && pnpm --filter @grokdesk/desktop e2e:chat
 *   pnpm --filter @grokdesk/desktop visual-qa
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "off",
  },
});
