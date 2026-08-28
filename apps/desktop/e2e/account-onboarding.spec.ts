/**
 * Electron E2E: onboarding, fresh signed-out, sign-in/out transitions.
 * Opt-in with `pnpm e2e` from apps/desktop (requires prior build).
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";

const desktopRoot = process.cwd();
const mainEntry = path.join(desktopRoot, "out/main/index.js");

function isolatedEnv(userData: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GROKDESK_E2E: "1",
    GROKDESK_PROVIDER_ENGINE: "1",
    GROKDESK_PROVIDER_ID: "fake",
    GROKDESK_DATA_DIR: path.join(userData, "gateway-data"),
    GROKDESK_NODE_PATH: process.execPath,
    GROKDESK_SKIP_BROWSER_LOGIN: "1",
    HOME: userData,
    USERPROFILE: userData,
  };
}

async function closeElectron(app: ElectronApplication): Promise<void> {
  const appProcess = app.process();
  if (!appProcess.killed) appProcess.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => appProcess.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (appProcess.exitCode === null) appProcess.kill("SIGKILL");
}

async function dismissOnboarding(page: import("@playwright/test").Page) {
  for (let i = 0; i < 10; i++) {
    const skip = page.getByRole("button", {
      name: /continue without|explore without|skip|not now/i,
    });
    if ((await skip.count()) > 0) {
      await skip.first().click({ timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(200);
      continue;
    }
    const next = page.getByRole("button", {
      name: /continue|next|get started|enter|finish|start/i,
    });
    if ((await next.count()) === 0) break;
    await next.first().click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
  // Tour / What's new mount after the wizard unmounts — wait briefly.
  await page
    .getByTestId("product-tour-skip")
    .click({ timeout: 5_000 })
    .catch(() => {});
  await page
    .getByTestId("whats-new-dismiss")
    .click({ timeout: 3_000 })
    .catch(() => {});
}

/** Seed SuperGrok auth.json under HOME so Desk boots signed-in (no OAuth). */
function seedSignedInAuth(home: string, email = "e2e@example.com") {
  const grokDir = path.join(home, ".grok");
  fs.mkdirSync(grokDir, { recursive: true });
  fs.writeFileSync(
    path.join(grokDir, "auth.json"),
    JSON.stringify({
      "https://auth.x.ai::client": {
        email,
        first_name: "E2E",
        last_name: "User",
        refresh_token: "e2e-refresh-token-not-a-secret-for-ui",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
    }),
  );
}

function authFileExists(home: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(home, ".grok", "auth.json"), "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    return Object.keys(data).length > 0;
  } catch {
    return false;
  }
}

test.describe("account + onboarding", () => {
  test("fresh profile never shows reauth copy when signed out", async () => {
    test.setTimeout(90_000);
    test.skip(
      !fs.existsSync(mainEntry),
      "desktop build missing (out/main/index.js)",
    );

    const userData = fs.mkdtempSync(
      path.join(os.tmpdir(), "grokdesk-e2e-fresh-"),
    );
    const app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`],
      cwd: desktopRoot,
      env: isolatedEnv(userData),
    });

    try {
      const page = await app.firstWindow({ timeout: 60_000 });
      await page.waitForLoadState("domcontentloaded");
      await expect(page).toHaveTitle(/Grok Desk/i, { timeout: 30_000 });

      const onboarding = page.getByTestId("first-launch");
      await expect(onboarding).toBeVisible({ timeout: 30_000 });
      const sceneButtons = onboarding.locator('button[aria-label*="Step "]');
      await expect(sceneButtons).toHaveCount(6);
      for (let index = 0; index < 6; index += 1) {
        await expect(sceneButtons.nth(index)).toBeEnabled();
      }
      await sceneButtons.last().click();
      await expect(sceneButtons.last()).toHaveAttribute("aria-current", "step");
      await page.keyboard.press("ArrowLeft");
      await expect(sceneButtons.nth(4)).toHaveAttribute("aria-current", "step");

      await dismissOnboarding(page);

      await expect(page.getByText(/sign in again/i)).toHaveCount(0);
      await expect(page.getByText(/sign in/i).first()).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await closeElectron(app);
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test("sign-in flow exposes cancelable signing_in state", async () => {
    test.skip(
      !fs.existsSync(mainEntry),
      "desktop build missing (out/main/index.js)",
    );

    const userData = fs.mkdtempSync(
      path.join(os.tmpdir(), "grokdesk-e2e-signin-"),
    );
    const app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`],
      cwd: desktopRoot,
      env: isolatedEnv(userData),
    });

    try {
      const page = await app.firstWindow({ timeout: 60_000 });
      await page.waitForLoadState("domcontentloaded");
      await dismissOnboarding(page);

      const signInBtn = page
        .getByRole("button", { name: /sign in/i })
        .first();
      if ((await signInBtn.count()) === 0) {
        await page.getByText(/sign in/i).first().click({ timeout: 10_000 });
      } else {
        await signInBtn.click({ timeout: 10_000 });
      }

      const cancel = page.getByRole("button", { name: /cancel/i });
      await expect(cancel.first()).toBeVisible({ timeout: 10_000 });

      await cancel.first().click({ timeout: 5_000 });
      await page.waitForTimeout(500);
      await expect(page.getByText(/sign in again/i)).toHaveCount(0);
    } finally {
      await closeElectron(app);
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test("sign-out after signed-in session persists on relaunch", async () => {
    test.skip(
      !fs.existsSync(mainEntry),
      "desktop build missing (out/main/index.js)",
    );

    const userData = fs.mkdtempSync(
      path.join(os.tmpdir(), "grokdesk-e2e-signout-"),
    );
    // Seed a real SuperGrok session file so auth.status reports signed_in.
    seedSignedInAuth(userData, "persist-e2e@example.com");
    expect(authFileExists(userData)).toBe(true);

    const env = isolatedEnv(userData);

    // Session 1: boot signed-in → sign out via product UI
    {
      const app = await electron.launch({
        args: [mainEntry, `--user-data-dir=${userData}`],
        cwd: desktopRoot,
        env,
      });
      try {
        const page = await app.firstWindow({ timeout: 60_000 });
        await page.waitForLoadState("domcontentloaded");
        await dismissOnboarding(page);

        // Accept sign-out confirm dialog(s)
        page.on("dialog", async (dialog) => {
          await dialog.accept();
        });

        // Wait for account identity from seeded auth (background probe)
        await expect(
          page.getByText(/persist-e2e@example.com|E2E/i).first(),
        ).toBeVisible({ timeout: 45_000 });

        // Open account menu and Sign out
        const accountTrigger = page
          .getByText(/persist-e2e@example.com|E2E/i)
          .first();
        await accountTrigger.click({ timeout: 10_000 });

        const signOut = page.getByRole("menuitem", {
          name: /sign out|log out/i,
        });
        if ((await signOut.count()) > 0) {
          await signOut.first().click({ timeout: 10_000 });
        } else {
          // Fallback: settings account sign-out
          const gear = page.getByTitle("Settings");
          if ((await gear.count()) > 0) {
            await gear.first().click({ timeout: 10_000 });
          }
          await page
            .getByRole("button", { name: /sign out/i })
            .first()
            .click({ timeout: 15_000 });
        }

        // UI should flip to signed-out invite
        await expect(page.getByText(/sign in/i).first()).toBeVisible({
          timeout: 20_000,
        });
        await expect(page.getByText(/sign in again/i)).toHaveCount(0);

        // Desk sign-out must not delete the shared CLI session file.
        await expect
          .poll(() => authFileExists(userData), { timeout: 15_000 })
          .toBe(true);
      } finally {
        await closeElectron(app);
      }
    }

    // Session 2: relaunch same HOME — must stay signed out
    {
      const app = await electron.launch({
        args: [mainEntry, `--user-data-dir=${userData}`],
        cwd: desktopRoot,
        env,
      });
      try {
        const page = await app.firstWindow({ timeout: 60_000 });
        await page.waitForLoadState("domcontentloaded");
        await dismissOnboarding(page);

        await expect(page.getByText(/sign in again/i)).toHaveCount(0);
        await expect(
          page.getByText(/persist-e2e@example.com/i),
        ).toHaveCount(0);
        await expect(page.getByText(/sign in/i).first()).toBeVisible({
          timeout: 20_000,
        });
        expect(authFileExists(userData)).toBe(true);
      } finally {
        await closeElectron(app);
        fs.rmSync(userData, { recursive: true, force: true });
      }
    }
  });
});
