/**
 * Electron E2E: in-app browser capability surface (globe + handshake).
 * Opens a real task workspace so BrowserGlobe mounts with data-browser-state.
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { test, expect, _electron as electron } from "@playwright/test";

const desktopRoot = process.cwd();
const mainEntry = path.join(desktopRoot, "out/main/index.js");
const packagedEntry = path.join(
  desktopRoot,
  "release/mac-arm64/Grok Desk.app/Contents/MacOS/Grok Desk",
);

type BridgeResponse<T> = {
  ok: boolean;
  result?: T;
  error?: string;
};

test("opens local HTML in the in-app browser without external fallback", async () => {
  test.skip(
    !fs.existsSync(mainEntry) && !fs.existsSync(packagedEntry),
    "desktop build missing — run electron-vite build first",
  );

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-e2e-br-"));
  const usePackagedApp =
    process.env.GROKDESK_E2E_USE_UNPACKAGED !== "1" &&
    fs.existsSync(packagedEntry);
  const app = await electron.launch({
    ...(usePackagedApp ? { executablePath: packagedEntry } : {}),
    args: [
      ...(usePackagedApp ? [] : [mainEntry]),
      `--user-data-dir=${userData}`,
    ],
    cwd: desktopRoot,
    env: {
      ...process.env,
      GROKDESK_SKIP_BROWSER_LOGIN: "1",
      HOME: userData,
      USERPROFILE: userData,
    },
  });

  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveTitle(/Grok Desk/i, { timeout: 30_000 });

    await test.step("bypass onboarding and select deterministic engine", async () => {
      const response = await page.evaluate(async () => {
        return (await Promise.race([
          window.grokdesk.request({
            id: "browser-e2e-settings",
            method: "settings.set",
            params: { onboardingCompleted: true },
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("settings IPC timed out")), 15_000),
          ),
        ])) as BridgeResponse<unknown>;
      });
      expect(response.ok, response.error).toBe(true);
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
    });

    const cspErrors: string[] = [];
    page.on("console", (msg) => {
      if (
        msg.type() === "error" &&
        /Content Security Policy/i.test(msg.text())
      ) {
        cspErrors.push(msg.text());
      }
    });

    expect(cspErrors.filter((e) => /\[::1\]/i.test(e))).toEqual([]);

    // Open a real workspace so BrowserGlobe is mounted (not home-only).
    await test.step("create and open a task workspace", async () => {
      const composer = page.locator("textarea").first();
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await composer.fill("Open the in-app browser and check example.com");
      await composer.press("Enter");
    });

    const task = await test.step("read the durable task", async () => {
      return page.evaluate(async () => {
        const response = (await Promise.race([
          window.grokdesk.request({
            id: "browser-e2e-tasks",
            method: "tasks.list",
            params: {},
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("tasks.list timed out")), 15_000),
          ),
        ])) as BridgeResponse<
          Array<{ id: string; policySnapshot: { workspaceRoots: string[] } }>
        >;
        if (!response.ok || !response.result?.[0]) {
          throw new Error(response.error || "task was not created");
        }
        return response.result[0];
      });
    });
    const workspaceRoot = task.policySnapshot.workspaceRoots[0];
    expect(workspaceRoot).toBeTruthy();
    const htmlPath = path.join(workspaceRoot!, "browser-smoke.html");
    fs.writeFileSync(
      htmlPath,
      "<!doctype html><title>In-app browser smoke</title><main>Browser ready</main>",
    );

    const capability = await test.step("verify in-app capability", async () => {
      return page.evaluate(async () => {
        const response = (await Promise.race([
          window.grokdesk.request({
            id: "browser-e2e-capability",
            method: "browser.capability",
            params: {},
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("browser.capability timed out")),
              15_000,
            ),
          ),
        ])) as BridgeResponse<{
          ok?: boolean;
          status?: string;
          provider?: string;
          tools?: string[];
        }>;
        if (!response.ok) throw new Error(response.error || "capability failed");
        return response.result;
      });
    });
    expect(capability?.ok).toBe(true);
    expect(capability?.status).toMatch(/ready|active/);
    expect(capability?.provider).not.toBe("none");

    const opened = await test.step("open local HTML in the native pane", async () =>
      page.evaluate(
        async ({ taskId, filePath }) => {
          const response = (await Promise.race([
            window.grokdesk.request({
              id: "browser-e2e-open",
              method: "browser.openHtml",
              params: { taskId, path: filePath },
            }),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("browser.openHtml timed out")),
                15_000,
              ),
            ),
          ])) as BridgeResponse<{ ok?: boolean; output?: string }>;
          if (!response.ok) throw new Error(response.error || "open IPC failed");
          return response.result;
        },
        { taskId: task.id, filePath: htmlPath },
      ),
    );
    expect(opened?.ok, opened?.output).toBe(true);

    // Workspace header should show the confirmed in-app browser state, and the
    // native pane must open rather than prompting for an external browser.
    const globe = page.locator("[data-browser-state]");
    await expect(globe.first()).toBeVisible({ timeout: 30_000 });
    await expect(globe.first()).toHaveAttribute("data-browser-state", "active", {
      timeout: 30_000,
    });
    await expect(page.locator('[data-browser-open="true"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("[data-browser-pane]")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText(/In-app browser is unavailable|Use external browser/i),
    ).toHaveCount(0);

    // Pin attribute is always present on the control
    const pinned = await globe.first().getAttribute("data-pinned");
    expect(pinned === "true" || pinned === "false").toBe(true);

  } finally {
    // BrowserView/WebContents teardown can outlive Playwright's close request.
    // Terminate the isolated E2E process explicitly so successful assertions
    // are not hidden behind an unrelated runner-cleanup timeout.
    const appProcess = app.process();
    if (!appProcess.killed) appProcess.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => appProcess.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (appProcess.exitCode === null) appProcess.kill("SIGKILL");
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
