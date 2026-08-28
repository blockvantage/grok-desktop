/**
 * Isolated Electron launch for deterministic chat e2e (fake provider).
 * CI must fail (not skip) when out/main is missing or Electron cannot launch.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { assertNoRealProfileEnv, FAKE_PROVIDER_ENV } from "./test-profile";
import { requireBuiltMainOrSkip } from "./desk-app";

const desktopRoot = process.cwd();

export type RpcResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

export type DeskSession = {
  app: ElectronApplication;
  page: Page;
  profileDir: string;
  workspaceDir: string;
  gatewayDir: string;
  close: () => Promise<void>;
};

function seedSyntheticAuth(home: string, email = "chat-e2e@grokdesk.local"): void {
  const directory = path.join(home, ".grok");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "auth.json"),
    JSON.stringify({
      "https://auth.x.ai::client": {
        email,
        first_name: "Chat",
        last_name: "E2E",
        refresh_token: "isolated-e2e-token",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
    }),
  );
}

function captureLaunchUnavailable(error: unknown): void {
  const scratchCandidates = [
    process.env.GROKDESK_E2E_SCRATCH,
    "/var/folders/z7/z80ljz_s2bd_d2z3sp2czndr0000gn/T/grok-goal-2c38cbaa0b09/implementer",
    os.tmpdir(),
  ].filter((p): p is string => Boolean(p));
  const target = path.join(scratchCandidates[0]!, "e2e-launch-unavailable.txt");
  const text = error instanceof Error ? `${error.stack ?? error.message}` : String(error);
  try {
    fs.writeFileSync(target, `${new Date().toISOString()}\n${text}\n`);
  } catch {
    /* best-effort */
  }
}

export async function rpc<T>(
  page: Page,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await page.evaluate(
    ({ method, params }) =>
      window.grokdesk.request({
        id: `chat-e2e-${Date.now()}-${Math.random()}`,
        method,
        params,
      }) as Promise<RpcResponse<unknown>>,
    { method, params },
  );
  if (!response.ok) throw new Error(response.error);
  return response.result as T;
}

export async function waitForGateway(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.grokdesk.gatewayStatus()), {
      timeout: 60_000,
      intervals: [100, 250, 500, 1_000],
    })
    .toBe("ready");
}

export async function waitForTaskStatus(
  page: Page,
  id: string,
  status: string,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await rpc<{ status: string }>(page, "tasks.get", { taskId: id }))
          .status,
      { timeout: 45_000, intervals: [100, 250, 500] },
    )
    .toBe(status);
}

export async function openFirstChat(page: Page): Promise<void> {
  const chatRow = page.locator(".chat-row > button").first();
  await expect(chatRow).toBeVisible({ timeout: 30_000 });
  await chatRow.click();
  await expect(
    page.locator('[data-testid="workspace-sticky-composer"]'),
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * Dispatch a drop with File.path set so the renderer path helper (and
 * getPathForFile fallback) can resolve a native path in Electron 43.
 */
export async function dropNativeFile(
  page: Page,
  selector: string,
  filePath: string,
): Promise<void> {
  const name = path.basename(filePath);
  const content = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : "e2e drop fixture\n";
  await page.evaluate(
    ({ selector, filePath, name, content }) => {
      const target = document.querySelector(selector);
      if (!target) throw new Error(`missing drop target ${selector}`);
      const file = new File([content], name, { type: "text/plain" });
      Object.defineProperty(file, "path", { value: filePath });
      const dt = new DataTransfer();
      dt.items.add(file);
      for (const type of ["dragenter", "dragover", "drop"] as const) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", { value: dt });
        target.dispatchEvent(event);
      }
    },
    { selector, filePath, name, content },
  );
}

export function watchNativeDialogs(page: Page): { count: () => number } {
  let n = 0;
  page.on("dialog", (dialog) => {
    n += 1;
    void dialog.dismiss();
  });
  return { count: () => n };
}

export async function crashGateway(page: Page): Promise<void> {
  const result = await page.evaluate(async () => {
    if (!window.grokdesk.e2e?.crashGateway) {
      throw new Error("e2e crashGateway missing — GROKDESK_E2E=1 required");
    }
    return window.grokdesk.e2e.crashGateway();
  });
  if (result && result.ok === false) {
    throw new Error(result.error ?? "crashGateway failed");
  }
}

export async function launchIsolatedDesk(opts?: {
  prefix?: string;
}): Promise<DeskSession> {
  assertNoRealProfileEnv();
  const built = requireBuiltMainOrSkip({
    allowSkipMissingBuild: false,
    desktopRoot,
  });
  if ("skip" in built) {
    throw new Error(built.reason);
  }

  const profileDir = fs.mkdtempSync(
    path.join(os.tmpdir(), opts?.prefix ?? "grokdesk-chat-e2e-"),
  );
  const gatewayDir = path.join(profileDir, "gateway");
  const workspaceDir = path.join(profileDir, "workspace");
  fs.mkdirSync(gatewayDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  seedSyntheticAuth(profileDir);

  let app: ElectronApplication;
  try {
    app = await electron.launch({
      args: [built.main, `--user-data-dir=${profileDir}`],
      cwd: desktopRoot,
      env: {
        ...process.env,
        ...FAKE_PROVIDER_ENV,
        GROKDESK_DATA_DIR: gatewayDir,
        GROKDESK_NODE_PATH: process.execPath,
        GROKDESK_SKIP_BROWSER_LOGIN: "1",
        HOME: profileDir,
        USERPROFILE: profileDir,
        LANG: "en_US.UTF-8",
      },
      timeout: 60_000,
    });
  } catch (error) {
    captureLaunchUnavailable(error);
    fs.rmSync(profileDir, { recursive: true, force: true });
    throw error;
  }

  const page = await app.firstWindow({ timeout: 60_000 });
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.waitForLoadState("domcontentloaded");
  await waitForGateway(page);

  await rpc(page, "settings.set", {
    onboardingCompleted: true,
    defaultApprovalMode: "strict",
    trustedFolders: [workspaceDir],
  });
  await page.evaluate((workspace) => {
    localStorage.setItem("grokdesk.lastWorkspaceRoot", workspace);
    // Chat journeys skip the post-wizard tour / What's new overlay.
    localStorage.setItem("grokdesk.productTour.completed.v1", "1");
    localStorage.setItem("grokdesk.whatsNew.seen.v1", "99.0.0");
  }, workspaceDir);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await waitForGateway(page);

  const close = async () => {
    try {
      await app.close();
    } catch {
      const proc = app.process();
      if (proc && !proc.killed) proc.kill("SIGTERM");
    }
    fs.rmSync(profileDir, { recursive: true, force: true });
  };

  return { app, page, profileDir, workspaceDir, gatewayDir, close };
}
