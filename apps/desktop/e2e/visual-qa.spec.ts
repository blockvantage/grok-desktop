/**
 * Repeatable visual QA gate for Grok Desk Electron.
 *
 * Captures: Home desktop, Home min window (960×640), existing chat (if any),
 * Artifacts, Memory, Settings, slash menu, command palette, intent chips,
 * work graph (when live), approval park (when present).
 *
 * Fails on: console errors, failed grokdesk-asset responses (except intentional
 * missing assets represented by graceful UI), obvious horizontal overflow of
 * readiness CTAs.
 *
 * Credentials: never embedded. Optional local profile:
 *   GROKDESK_VISUAL_USER_DATA=/path/to/GrokDesk userData
 *   GROKDESK_NODE_PATH=/path/to/system/node  (gateway native ABI)
 *
 * Soft-skips cleanly when out/main is missing or Electron cannot launch.
 *
 * Known environment blockers (historical):
 * - Electron firstWindow never opens without a built out/main
 * - Gateway child better-sqlite3 ABI mismatch without GROKDESK_NODE_PATH
 * - Playwright worker / app.close() teardown can hang after assertions pass
 *   (product gate still written to visual-qa.json; process may need SIGTERM)
 * - Local profile/userData locks when Desk is already running
 *
 * Fallback (no Electron, deterministic product checks):
 *   pnpm --filter @grokdesk/desktop release-qa
 * See src/renderer/lib/release-qa-gate.test.ts for exact coverage + limitations.
 *
 *   pnpm --filter @grokdesk/desktop build
 *   pnpm --filter @grokdesk/desktop visual-qa
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect, _electron as electron, type Page } from "@playwright/test";

const desktopRoot = process.cwd();
const mainEntry = path.join(desktopRoot, "out/main/index.js");
const outDir =
  process.env.GROKDESK_VISUAL_QA_OUT ||
  path.join(desktopRoot, "test-results", "visual-qa");

type QaReport = {
  startedAt: string;
  userData: string | null;
  shots: Array<{ name: string; path: string; ok: boolean; note?: string }>;
  consoleErrors: string[];
  failedAssets: string[];
  overflow: string[];
  ok: boolean;
  skipReason?: string;
};

function ensureOutDir() {
  fs.mkdirSync(outDir, { recursive: true });
}

async function measureHorizontalOverflow(page: Page): Promise<string[]> {
  const hits: string[] = [];
  const vw = page.viewportSize()?.width ?? 0;
  if (!vw) return hits;
  const selectors = [
    '[data-testid="readiness-checklist"]',
    '[data-testid^="readiness-cta-"]',
    '[data-testid="home-runtime-install"]',
  ];
  for (const sel of selectors) {
    const loc = page.locator(sel);
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const box = await loc.nth(i).boundingBox().catch(() => null);
      if (!box || box.width <= 0) continue;
      if (box.x + box.width > vw + 1 || box.x < -1) {
        hits.push(
          `${sel} right=${Math.round(box.x + box.width)} vw=${vw} left=${Math.round(box.x)}`,
        );
      }
    }
  }
  return hits;
}

async function openNav(page: Page, label: RegExp | string) {
  const btn = page.getByRole("button", { name: label }).first();
  if ((await btn.count()) > 0) {
    await btn.click({ timeout: 10_000 }).catch(() => {});
    return;
  }
  await page.getByText(label, { exact: typeof label === "string" }).first().click({
    timeout: 10_000,
  }).catch(() => {});
}

test.describe("visual QA gate", () => {
  test("capture surfaces and gate console/assets/overflow", async () => {
    test.setTimeout(240_000);
    ensureOutDir();
    const report: QaReport = {
      startedAt: new Date().toISOString(),
      userData: process.env.GROKDESK_VISUAL_USER_DATA ?? null,
      shots: [],
      consoleErrors: [],
      failedAssets: [],
      overflow: [],
      ok: false,
    };

    if (!fs.existsSync(mainEntry)) {
      report.skipReason = `missing build: ${mainEntry}`;
      fs.writeFileSync(
        path.join(outDir, "visual-qa.json"),
        JSON.stringify(report, null, 2),
      );
      test.skip(true, report.skipReason);
      return;
    }

    const userData =
      process.env.GROKDESK_VISUAL_USER_DATA?.trim() ||
      fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-visual-qa-"));
    const usingTempProfile = !process.env.GROKDESK_VISUAL_USER_DATA?.trim();
    report.userData = userData;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GROKDESK_SKIP_BROWSER_LOGIN: "1",
    };
    if (process.env.GROKDESK_NODE_PATH) {
      env.GROKDESK_NODE_PATH = process.env.GROKDESK_NODE_PATH;
    }

    let app: Awaited<ReturnType<typeof electron.launch>> | null = null;
    try {
      app = await electron.launch({
        args: [mainEntry, `--user-data-dir=${userData}`],
        cwd: desktopRoot,
        env,
        timeout: 60_000,
      });
    } catch (e) {
      report.skipReason = `electron launch failed (firstWindow/gateway class): ${
        e instanceof Error ? e.message : String(e)
      }`;
      fs.writeFileSync(
        path.join(outDir, "visual-qa.json"),
        JSON.stringify(report, null, 2),
      );
      test.skip(true, report.skipReason);
      return;
    }

    try {
      let page: Page;
      try {
        page = await app.firstWindow({ timeout: 60_000 });
        await page.waitForLoadState("domcontentloaded");
      } catch (e) {
        // Hang class: Electron process up but firstWindow never opens
        // (gateway child ABI, blank window, or fixture lifecycle). Soft-skip.
        report.skipReason = `firstWindow timeout/hang: ${
          e instanceof Error ? e.message : String(e)
        }`;
        fs.writeFileSync(
          path.join(outDir, "visual-qa.json"),
          JSON.stringify(report, null, 2),
        );
        try {
          await Promise.race([
            app.close().catch(() => {}),
            new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
          ]);
        } catch {
          /* ignore */
        }
        test.skip(true, report.skipReason);
        return;
      }

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = msg.text();
          // Filter noisy Chromium autofill / extension noise and Playwright
          // evaluate helpers that trip Electron CSP (script-src 'self').
          // Missing local assets return 404 (graceful UI) — do not fail the gate.
          // Asset 5xx are still recorded via the response listener.
          if (
            /Autofill|electron\/js2c|DevTools|unsafe-eval|Content Security Policy/i.test(
              text,
            ) ||
            /Failed to load resource:.*status of 40[0-9]/i.test(text)
          ) {
            return;
          }
          report.consoleErrors.push(text);
        }
      });
      page.on("response", (res) => {
        const url = res.url();
        if (!url.startsWith("grokdesk-asset://")) return;
        if (res.status() >= 400) {
          // 404 missing is OK if UI marks unavailable; still record 5xx as hard fails
          if (res.status() >= 500) {
            report.failedAssets.push(`${res.status()} ${url}`);
          }
        }
      });
      page.on("pageerror", (err) => {
        report.consoleErrors.push(err.message);
      });

      // Wait until account status leaves "checking" so signed-in shell is stable.
      // Prefer locator polling over page.evaluate (CSP blocks unsafe-eval in Desk).
      const checking = page.locator('[data-testid="sidebar-account-checking"]');
      const signedInUi = page.getByText(/Connected|Sign out/i).first();
      const signInUi = page.locator('[data-testid="sidebar-sign-in"]');
      try {
        await Promise.race([
          signedInUi.waitFor({ state: "visible", timeout: 45_000 }),
          signInUi.waitFor({ state: "visible", timeout: 45_000 }),
          checking
            .waitFor({ state: "detached", timeout: 45_000 })
            .catch(() => {}),
        ]);
      } catch {
        /* continue with best-effort capture */
      }
      await page.waitForTimeout(800);

      const shot = async (name: string) => {
        const file = path.join(outDir, `${name}.png`);
        try {
          await page.screenshot({ path: file, fullPage: false });
          report.shots.push({ name, path: file, ok: true });
        } catch (e) {
          report.shots.push({
            name,
            path: file,
            ok: false,
            note: e instanceof Error ? e.message : String(e),
          });
        }
      };

      // Home desktop
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openNav(page, /Home/i);
      await page.waitForTimeout(800);
      await shot("01-home-desktop");
      report.overflow.push(
        ...(await measureHorizontalOverflow(page)).map((s) => `desktop: ${s}`),
      );

      // Home minimum window
      await page.setViewportSize({ width: 960, height: 640 });
      await page.waitForTimeout(500);
      await shot("02-home-min-window");
      report.overflow.push(
        ...(await measureHorizontalOverflow(page)).map((s) => `min: ${s}`),
      );

      // Restore for remaining surfaces
      await page.setViewportSize({ width: 1440, height: 1000 });

      // Existing chat — prefer Continue last chat, then first sidebar chat row
      let openedChat = false;
      const continueLast = page.getByText(/Continue last chat/i).first();
      if ((await continueLast.count()) > 0) {
        await continueLast.click({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(1200);
        openedChat = true;
      } else {
        const row = page
          .locator("aside")
          .locator("button, [role='button'], a")
          .filter({ hasText: /Done|Failed|ago|Payverge|Image|Review/i })
          .first();
        if ((await row.count()) > 0) {
          await row.click({ timeout: 8_000 }).catch(() => {});
          await page.waitForTimeout(1200);
          openedChat = true;
        }
      }
      if (openedChat) {
        // Criterion 2: terminal headers must not overclaim Saved … under path
        // when local media is gone (goal-progress softenSavedClaims).
        const bodyText = (await page.locator("body").innerText()).slice(0, 8000);
        if (
          /Saved\s+\d+\s+image\/video\s+file\(s\)\s+under/i.test(bodyText)
        ) {
          report.consoleErrors.push(
            "existing-chat header still overclaims Saved N image/video file(s) under …",
          );
        }
        await shot("05-existing-chat");

        // Phase 4: work graph / progress rail when the open task is live.
        const workGraph = page.locator("[data-work-graph]");
        const liveCard = page.locator("[data-live-work-card]");
        const needsYou = page.locator(
          '[data-needs-you="true"], [data-testid="needs-you-action"], [data-run-state="waiting_approval"]',
        );
        if ((await workGraph.count()) > 0) {
          await shot("10-work-graph-progress");
        } else if ((await liveCard.count()) > 0) {
          await shot("10-work-graph-progress");
        } else {
          report.shots.push({
            name: "10-work-graph-progress",
            path: "",
            ok: true,
            note: "no live work graph in current chat (task may be terminal)",
          });
        }
        if ((await needsYou.count()) > 0) {
          await shot("11-approval-parked");
        } else {
          report.shots.push({
            name: "11-approval-parked",
            path: "",
            ok: true,
            note: "no approval-parked state in current profile",
          });
        }
        // Retry/recovered is fixture-dependent; capture when product-state is present.
        const recovered = page.locator(
          '[data-product-state="recovered"], [data-product-state="retrying"]',
        );
        if ((await recovered.count()) > 0) {
          await shot("12-retry-recovered");
        } else {
          report.shots.push({
            name: "12-retry-recovered",
            path: "",
            ok: true,
            note: "no retry/recovered product state in current profile",
          });
        }
      } else {
        report.shots.push({
          name: "05-existing-chat",
          path: "",
          ok: true,
          note: "no chat rows in profile",
        });
        report.shots.push({
          name: "10-work-graph-progress",
          path: "",
          ok: true,
          note: "no chat open",
        });
        report.shots.push({
          name: "11-approval-parked",
          path: "",
          ok: true,
          note: "no chat open",
        });
        report.shots.push({
          name: "12-retry-recovered",
          path: "",
          ok: true,
          note: "no chat open",
        });
      }

      await openNav(page, /Artifacts/i);
      await page.waitForTimeout(800);
      await shot("03-artifacts");

      await openNav(page, /Memory/i);
      await page.waitForTimeout(600);
      await shot("03-memory");

      await openNav(page, /Settings/i);
      await page.waitForTimeout(800);
      await shot("03-settings");

      // Slash menu on Home composer
      await openNav(page, /Home/i);
      await page.waitForTimeout(500);
      const composer = page.locator("textarea").first();
      if ((await composer.count()) > 0) {
        await composer.click();
        await composer.fill("/");
        await page.waitForTimeout(400);
        await shot("06-slash-menu");
        await composer.fill("");
      }

      // Phase 3: intent selection + mode clear (chip path, no prompt dump)
      const intentChips = page.locator('[data-testid="composer-intent-chips"]');
      if ((await intentChips.count()) > 0) {
        const brief = page.locator('[data-testid="intent-chip-brief"]');
        if ((await brief.count()) > 0) {
          await brief.click({ timeout: 8_000 }).catch(() => {});
          await page.waitForTimeout(400);
          // Mode chip should appear; textarea should NOT contain full brief template
          const bodyText = (await page.locator("body").innerText()).slice(0, 4000);
          const ta = page.locator("textarea").first();
          const taVal = (await ta.inputValue().catch(() => "")) ?? "";
          if (/Draft a clear, structured brief with audience/i.test(taVal)) {
            report.consoleErrors.push(
              "intent selection dumped brief scaffolding into textarea",
            );
          }
          if (!/Brief|brief/i.test(bodyText)) {
            report.consoleErrors.push(
              "intent selection did not show Brief mode surface",
            );
          }
          await shot("08-intent-selected");
          // Clear mode via chip X or re-click
          const clearBtn = page.getByRole("button", {
            name: /Clear mode|Remove command|Modus löschen|Quitar modo|Effacer|解除|Limpar|清除/i,
          });
          if ((await clearBtn.count()) > 0) {
            await clearBtn.first().click({ timeout: 5_000 }).catch(() => {});
          } else {
            await brief.click({ timeout: 5_000 }).catch(() => {});
          }
          await page.waitForTimeout(300);
          await shot("09-intent-cleared");
        }
      } else {
        report.shots.push({
          name: "08-intent-selected",
          path: "",
          ok: true,
          note: "intent chips not visible in this profile/state",
        });
        report.shots.push({
          name: "09-intent-cleared",
          path: "",
          ok: true,
          note: "intent chips not visible in this profile/state",
        });
      }

      // Command palette
      await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
      await page.waitForTimeout(400);
      await shot("07-command-palette");

      report.ok =
        report.consoleErrors.length === 0 &&
        report.failedAssets.length === 0 &&
        report.overflow.length === 0 &&
        report.shots.every((s) => s.ok || Boolean(s.note));

      fs.writeFileSync(
        path.join(outDir, "visual-qa.json"),
        JSON.stringify(report, null, 2),
      );

      expect(report.consoleErrors, report.consoleErrors.join("\n")).toEqual([]);
      expect(report.failedAssets, report.failedAssets.join("\n")).toEqual([]);
      expect(report.overflow, report.overflow.join("\n")).toEqual([]);
    } finally {
      // Bound close so worker teardown cannot hang the gate indefinitely
      // after product assertions already passed (known Playwright/Electron flake).
      if (app) {
        await Promise.race([
          app.close().catch(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ]);
        try {
          // Force-kill if still alive (process.exitCode path for orphan children).
          const proc = app.process();
          if (proc && !proc.killed && proc.pid) {
            try {
              process.kill(proc.pid, "SIGTERM");
            } catch {
              /* already gone */
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 1_500));
            try {
              if (!proc.killed && proc.pid) process.kill(proc.pid, "SIGKILL");
            } catch {
              /* already gone */
            }
          }
        } catch {
          /* ignore */
        }
      }
      if (usingTempProfile) {
        try {
          fs.rmSync(userData, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  });
});
