import { defineConfig } from "@playwright/test";

/**
 * Electron visual/smoke/chat E2E — not wired into monorepo `pnpm -r test`.
 *
 * Deterministic harness (Task 18):
 *   - Fresh temp userData + gateway data via fixtures/test-profile.ts
 *   - GROKDESK_PROVIDER_ENGINE=1 + GROKDESK_PROVIDER_ID=fake
 *   - GROKDESK_E2E=1 enables privileged crash/fault IPC (main only)
 *
 * visual-qa and e2e:chat fail (not skip) when out/main is missing or Electron
 * cannot launch. smoke / account / browser may still skip locally.
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
    trace: "retain-on-failure",
  },
});
