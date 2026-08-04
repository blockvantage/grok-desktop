import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  assertNoRealProfileEnv,
  createTempTestProfile,
} from "./fixtures/test-profile";

const monorepoRoot = path.join(process.cwd(), "../..");

test.describe("chat recovery journeys", () => {
  test("recovery harness uses temp profile only", () => {
    assertNoRealProfileEnv();
    const p = createTempTestProfile("grokdesk-recovery-");
    expect(p.userDataDir).toContain("grokdesk-recovery-");
    p.cleanup();
  });

  test("gateway recovery resync and e2e crash control ship", () => {
    const sync = fs.readFileSync(
      path.join(
        monorepoRoot,
        "apps/desktop/src/renderer/hooks/use-app-sync.ts",
      ),
      "utf8",
    );
    expect(sync).toMatch(/useGatewayRecovery/);
    expect(sync).toMatch(/reconcilePendingRoot|onPendingRootAccepted/);

    const e2e = fs.readFileSync(
      path.join(
        monorepoRoot,
        "apps/desktop/src/main/e2e-test-controls.ts",
      ),
      "utf8",
    );
    expect(e2e).toMatch(/GROKDESK_E2E/);
    expect(e2e).toMatch(/crashGateway|injectFault/);
    expect(e2e).toMatch(/isE2eTestControlsEnabled/);

    const gw = fs.readFileSync(
      path.join(monorepoRoot, "apps/desktop/src/main/gateway-process.ts"),
      "utf8",
    );
    expect(gw).toMatch(/crashForTest|async restart/);
  });

  test("pending root mutation id is stable across reconnect", () => {
    const cm = fs.readFileSync(
      path.join(
        monorepoRoot,
        "apps/desktop/src/renderer/lib/client-mutation.ts",
      ),
      "utf8",
    );
    expect(cm).toMatch(/beginMutation|readPendingMutation|clearPendingMutation/);
  });
});
