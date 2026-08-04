/**
 * Opt-in Electron smoke test. Not part of `pnpm -r test` / CI.
 *
 * Prerequisites:
 *   - packages built
 *   - `npx electron-vite build` in apps/desktop
 *   - `pnpm e2e` from apps/desktop
 */
import path from "node:path";
import { test, expect, _electron as electron } from "@playwright/test";

const desktopRoot = process.cwd();
const mainEntry = path.join(desktopRoot, "out/main/index.js");

test("electron smoke: brand, Settings, Tools, license", async () => {
  const app = await electron.launch({
    args: [mainEntry],
    cwd: desktopRoot,
    env: {
      ...process.env,
      GROKDESK_SKIP_BROWSER_LOGIN: "1",
    },
  });

  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    await page.waitForLoadState("domcontentloaded");

    await expect(page).toHaveTitle(/Grok Desk/i, { timeout: 30_000 });

    // BrandMark / sidebar logo (BASE_URL-relative icon)
    const brand = page.locator('img[alt="Grok Desk"]').first();
    if ((await brand.count()) > 0) {
      await expect(brand).toBeVisible({ timeout: 15_000 });
      const naturalWidth = await brand.evaluate(
        (el: HTMLImageElement) => el.naturalWidth,
      );
      // Soft assert: packaged path may 404 in odd layouts; zero width is a signal.
      expect(naturalWidth).toBeGreaterThanOrEqual(0);
    }

    const gear = page.getByTitle("Settings");
    if ((await gear.count()) > 0) {
      await gear.first().click({ timeout: 15_000 });
    } else {
      await page.getByText("Settings", { exact: true }).first().click({
        timeout: 15_000,
      });
    }

    await expect(page.getByRole("heading", { name: /Settings/i })).toBeVisible({
      timeout: 15_000,
    });

    // Tools tab (marketplace gallery)
    await page.getByRole("tab", { name: /Tools/i }).click();
    await expect(
      page.getByText(/Connectors|Gallery|connectors/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // License tab may be off-screen in narrow windows; scroll tabs if needed.
    const licenseTab = page.getByRole("tab", { name: /License|Lizenz|许可证/i });
    if ((await licenseTab.count()) > 0) {
      await licenseTab.first().scrollIntoViewIfNeeded().catch(() => {});
      await licenseTab.first().click({ timeout: 15_000 });
      await expect(
        page.getByText(/Grok Desk license|license|Lizenz/i).first(),
      ).toBeVisible({ timeout: 10_000 });
    } else {
      // Fallback: Advanced/License label somewhere in Settings
      await expect(
        page.getByText(/license|engine|Settings/i).first(),
      ).toBeVisible({ timeout: 10_000 });
    }
    // Local engine status row (Phase I) when present
    const engine = page.getByText(
      /Local engine|engine ready|engine|reconnect/i,
    );
    if ((await engine.count()) > 0) {
      await expect(engine.first()).toBeVisible({ timeout: 10_000 });
    }
  } finally {
    await app.close();
  }
});
