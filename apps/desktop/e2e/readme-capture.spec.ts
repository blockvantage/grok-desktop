import fs from "node:fs";
import path from "node:path";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  assertReadmeCaptureIsIsolated,
  createReadmeDemoProfile,
  type ReadmeDemoProfile,
} from "./fixtures/readme-demo";

const desktopRoot = process.cwd();
const repoRoot = path.resolve(desktopRoot, "../..");
const mainEntry = path.join(desktopRoot, "out/main/index.js");

type RpcResult<T> = { ok: true; result: T } | { ok: false; error: string };
type DemoTask = { id: string; status: string; goal: string };

async function rpc<T>(
  page: Page,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const result = await page.evaluate(
    async ({ rpcMethod, rpcParams }) => {
      return window.grokdesk.request({
        id: `readme-${Date.now()}-${Math.random()}`,
        method: rpcMethod,
        params: rpcParams,
      }) as Promise<RpcResult<unknown>>;
    },
    { rpcMethod: method, rpcParams: params },
  );
  if (!result.ok) throw new Error(result.error);
  return result.result as T;
}

async function waitForGateway(page: Page): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(() => window.grokdesk.gatewayStatus()),
      { timeout: 60_000, intervals: [100, 250, 500, 1_000] },
    )
    .toBe("ready");
}

async function waitForTaskStatus(
  page: Page,
  taskId: string,
  status: string,
): Promise<DemoTask> {
  let latest: DemoTask | null = null;
  await expect
    .poll(
      async () => {
        latest = await rpc<DemoTask>(page, "tasks.get", { taskId });
        return latest?.status;
      },
      { timeout: 30_000, intervals: [100, 250, 500] },
    )
    .toBe(status);
  return latest!;
}

async function openNav(page: Page, name: RegExp): Promise<void> {
  const button = page.getByRole("button", { name }).first();
  await expect(button).toBeVisible({ timeout: 15_000 });
  await button.click();
  await page.waitForTimeout(500);
}

async function capture(page: Page, profile: ReadmeDemoProfile, name: string) {
  const target = path.join(profile.rawDir, `${name}.png`);
  await page.screenshot({ path: target, fullPage: false, animations: "disabled" });
  const stat = fs.statSync(target);
  expect(stat.size, `${name} must be a non-empty product capture`).toBeGreaterThan(25_000);
}

test.describe.serial("README product capture", () => {
  test("profile fixture is deterministic and refuses real profiles", () => {
    expect(() =>
      assertReadmeCaptureIsIsolated({ GROKDESK_USER_DATA: "/real/profile" }),
    ).toThrow(/refused GROKDESK_USER_DATA/);

    const profile = createReadmeDemoProfile({ repoRoot, env: {} });
    expect(profile.root).toBe(path.join(repoRoot, "samples", "readme-demo"));
    expect(profile.env).toMatchObject({
      GROKDESK_E2E: "1",
      GROKDESK_PROVIDER_ENGINE: "1",
      GROKDESK_PROVIDER_ID: "fake",
      GROKDESK_DATA_DIR: profile.gatewayDataDir,
      GROKDESK_NODE_PATH: process.execPath,
      HOME: profile.root,
      ELECTRON_USER_DATA: profile.userDataDir,
      LANG: "en_US.UTF-8",
    });
    for (const directory of [
      profile.userDataDir,
      profile.gatewayDataDir,
      profile.workspaceDir,
      profile.rawDir,
      profile.logsDir,
    ]) {
      expect(fs.statSync(directory).isDirectory()).toBe(true);
    }
    const syntheticAuth = JSON.parse(
      fs.readFileSync(path.join(profile.root, ".grok", "auth.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(syntheticAuth)).toHaveLength(1);
    expect(JSON.stringify(syntheticAuth)).toContain("demo@grokdesk.local");
  });

  test("captures six authentic deterministic product states", async () => {
    test.setTimeout(180_000);
    expect(fs.existsSync(mainEntry), `missing build: ${mainEntry}`).toBe(true);
    const profile = createReadmeDemoProfile({ repoRoot });
    const consoleErrors: string[] = [];
    let app: ElectronApplication | null = null;

    try {
      app = await electron.launch({
        args: [mainEntry, `--user-data-dir=${profile.userDataDir}`],
        cwd: desktopRoot,
        env: profile.env,
        timeout: 60_000,
      });
      const page = await app.firstWindow({ timeout: 60_000 });
      await page.setViewportSize({ width: 1440, height: 960 });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const value = message.text();
        if (/Autofill|DevTools|unsafe-eval|Content Security Policy/i.test(value)) return;
        if (/Failed to load resource:.*status of 40[0-9]/i.test(value)) return;
        consoleErrors.push(value);
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      await page.waitForLoadState("domcontentloaded");
      await waitForGateway(page);

      // Seed only local settings, then reload into the normal shell. The task
      // and artifact state below still travels through the public gateway RPC.
      await rpc(page, "settings.set", {
        onboardingCompleted: true,
        defaultApprovalMode: "balanced",
        trustedFolders: [profile.workspaceDir],
      });
      await page.evaluate((workspaceDir) => {
        localStorage.setItem("grokdesk.lastWorkspaceRoot", workspaceDir);
        localStorage.setItem(
          "grokdesk.work-session.v1",
          JSON.stringify({
            conversationId: null,
            draft: "",
            surface: "home",
            updatedAt: "2026-08-04T12:00:00.000Z",
            workspaceRoot: workspaceDir,
            attachmentPaths: [],
            draftCleared: true,
          }),
        );
      }, profile.workspaceDir);
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await waitForGateway(page);
      await expect(page.locator('[data-testid="home-desk"]')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("Demo Workspace").first()).toBeVisible({
        timeout: 45_000,
      });
      const homeComposer = page.locator('[data-testid="home-desk"] textarea').first();
      if ((await homeComposer.count()) > 0) await homeComposer.fill("");
      await capture(page, profile, "home");

      const goal = "Prepare a launch brief and save the final report";
      const task = await rpc<DemoTask>(page, "tasks.create", {
        goal,
        workspaceRoots: [profile.workspaceDir],
        model: "fake-fast",
        effort: "normal",
        approvalMode: "strict",
        rolePack: null,
        clientMutationId: "readme-demo-root",
        locale: "en",
      });
      await waitForTaskStatus(page, task.id, "waiting_approval");

      const queued = await rpc<{
        outcome: string;
        item: { id: string };
      }>(page, "outbox.enqueue", {
        id: "readme-demo-follow-up",
        conversationId: task.id,
        parentTaskId: task.id,
        text: "Add a concise executive summary and implementation checklist.",
        attachments: [],
      });
      expect(queued.outcome).toBe("accepted");

      // Open the live conversation from Home's real attention surface.
      // Reload makes the proof independent from notify timing and hydrates the
      // durable task/outbox state exactly as a restart would.
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await waitForGateway(page);
      await openNav(page, /Home/i);
      const openNeedsYou = page.locator('[data-testid="needs-you-open"]').first();
      if (await openNeedsYou.isVisible().catch(() => false)) {
        await openNeedsYou.click();
      } else {
        const liveChat = page.locator(".chat-row > button").first();
        await expect(liveChat).toBeVisible({ timeout: 20_000 });
        await liveChat.click();
      }
      await expect(page.locator('[data-testid="workspace-sticky-composer"]')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator('[data-testid="conversation-outbox"]')).toBeVisible({
        timeout: 20_000,
      });
      await capture(page, profile, "active-queue");

      const jumpToApproval = page.getByRole("button", { name: /Jump to request/i });
      await expect(jumpToApproval).toBeVisible({ timeout: 20_000 });
      await jumpToApproval.click();
      const collapse = page.getByRole("button", { name: /^Collapse$/i });
      if (await collapse.isVisible().catch(() => false)) await collapse.click();
      await page.waitForTimeout(500);
      await capture(page, profile, "approval");

      await rpc(page, "outbox.remove", { id: queued.item.id });
      const events = await rpc<Array<{ kind: string; payload: Record<string, unknown> }>>(
        page,
        "events.list",
        { taskId: task.id, afterSeq: 0 },
      );
      const approval = [...events]
        .reverse()
        .find((event) => event.kind === "approval_required");
      const approvalId = String(approval?.payload.approvalId ?? "");
      expect(approvalId).not.toBe("");
      await rpc(page, "tasks.approve", {
        taskId: task.id,
        approvalId,
        decision: "approve",
      });
      await waitForTaskStatus(page, task.id, "done");
      await page.waitForTimeout(1_000);
      await capture(page, profile, "completed-work");

      await openNav(page, /Artifacts/i);
      await expect(page.locator('[data-testid="artifacts-view"]')).toBeVisible({
        timeout: 20_000,
      });
      await capture(page, profile, "artifacts");

      await openNav(page, /Settings/i);
      await expect(page.getByRole("heading", { name: /Settings/i })).toBeVisible({
        timeout: 20_000,
      });
      const preferences = page.getByRole("tab", { name: /Preferences/i });
      if ((await preferences.count()) > 0) await preferences.click();
      await capture(page, profile, "settings-trust");

      expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
      expect(fs.readdirSync(profile.rawDir).filter((name) => name.endsWith(".png")))
        .toHaveLength(6);
    } finally {
      if (app) {
        await Promise.race([
          app.close().catch(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ]);
        try {
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
          /* ignore teardown races after capture assertions */
        }
      }
    }
  });
});
