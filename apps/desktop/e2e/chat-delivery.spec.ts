/**
 * Chat delivery journeys on the fake provider: drag-drop chips, queue +
 * interject, drained follow-up settings, compact.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  assertNoRealProfileEnv,
  createTempTestProfile,
  FAKE_PROVIDER_ENV,
} from "./fixtures/test-profile";
import { buildDeskLaunchEnv } from "./fixtures/desk-app";
import {
  dropNativeFile,
  launchIsolatedDesk,
  openFirstChat,
  rpc,
  waitForGateway,
  waitForTaskStatus,
  watchNativeDialogs,
} from "./fixtures/electron-desk";

test.describe("chat delivery harness", () => {
  test("refuses real profile env and allocates temp profile", () => {
    assertNoRealProfileEnv();
    const p = createTempTestProfile();
    expect(fs.existsSync(p.userDataDir)).toBe(true);
    expect(FAKE_PROVIDER_ENV.GROKDESK_PROVIDER_ID).toBe("fake");
    p.cleanup();
  });

  test("launch env builder uses fake provider and temp data dirs", () => {
    const { env, profile } = buildDeskLaunchEnv();
    expect(env.GROKDESK_PROVIDER_ID).toBe("fake");
    expect(env.GROKDESK_E2E).toBe("1");
    expect(env.GROKDESK_DATA_DIR).toBe(profile.gatewayDataDir);
    profile.cleanup();
  });
});

test.describe("chat delivery journeys", () => {
  test("drop, queue+interject, compact, and drained follow-up settings", async () => {
    test.setTimeout(150_000);
    const desk = await launchIsolatedDesk({ prefix: "grokdesk-chat-delivery-" });
    const { page, workspaceDir } = desk;
    const dialogs = watchNativeDialogs(page);

    try {
      await expect(page.locator('[data-testid="home-desk"]')).toBeVisible({
        timeout: 30_000,
      });

      const dropFile = path.join(workspaceDir, "brief-notes.txt");
      fs.writeFileSync(dropFile, "notes for the launch brief\n");
      await dropNativeFile(page, '[data-testid="home-composer-drop"]', dropFile);
      await expect(
        page.locator(
          `[data-testid="attachment-chip"][data-attachment-name="brief-notes.txt"]`,
        ),
      ).toBeVisible({ timeout: 10_000 });

      const created = await rpc<{ id: string }>(page, "tasks.create", {
        goal: "Prepare a concise launch brief with one linked source",
        workspaceRoots: [workspaceDir],
        model: "fake-fast",
        effort: "heavy",
        approvalMode: "strict",
        allowNetworkTools: true,
        clientMutationId: "delivery-root",
        locale: "en",
      });
      await waitForTaskStatus(page, created.id, "waiting_approval");

      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await waitForGateway(page);
      await openFirstChat(page);

      const followDrop = path.join(workspaceDir, "follow-up-notes.txt");
      fs.writeFileSync(followDrop, "add a checklist\n");
      await dropNativeFile(
        page,
        '[data-testid="follow-up-composer-drop"]',
        followDrop,
      );
      await expect(
        page.locator(
          `[data-testid="attachment-chip"][data-attachment-name="follow-up-notes.txt"]`,
        ),
      ).toBeVisible({ timeout: 10_000 });

      const compact = await rpc<{ ok: boolean }>(page, "task.compact", {
        taskId: created.id,
      });
      expect(compact.ok).toBe(true);
      const summarize = page.locator('[data-testid="context-meter-summarize"]');
      if (await summarize.isVisible()) {
        await summarize.click();
      }

      const followUp = page
        .locator('[data-testid="follow-up-composer-drop"] textarea')
        .first();
      await expect(followUp).toBeVisible({ timeout: 15_000 });
      await followUp.fill("Add a concise executive summary.");
      await page
        .locator('[data-testid="follow-up-composer-drop"]')
        .evaluate((el) => (el as HTMLFormElement).requestSubmit());
      await expect(
        page.locator('[data-testid="conversation-outbox"]'),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("[data-queue-status]").first()).toContainText(
        "Add a concise executive summary",
        { timeout: 10_000 },
      );

      await page.locator("[data-queue-send-now]").first().click();
      await expect
        .poll(
          async () => {
            const list = await rpc<Array<{ status: string; text: string }>>(
              page,
              "outbox.list",
              { conversationId: created.id, includeTerminal: true },
            );
            return list.some(
              (item) =>
                item.text.includes("executive summary") &&
                (item.status === "delivered" || item.status === "accepted"),
            )
              ? "delivered"
              : list
                  .filter((item) => item.text.includes("executive summary"))
                  .map((item) => item.status)
                  .join(",") || "missing";
          },
          { timeout: 20_000, intervals: [200, 400, 800] },
        )
        .toBe("delivered");

      const queued = await rpc<{
        outcome: string;
        item: { id: string };
      }>(page, "outbox.enqueue", {
        id: "delivery-follow-settings",
        conversationId: created.id,
        parentTaskId: created.id,
        text: "Keep the same model and strict approvals.",
        attachments: [],
      });
      expect(queued.outcome).toBe("accepted");
      await expect(
        page.locator('[data-testid="conversation-outbox"]'),
      ).toBeVisible({ timeout: 15_000 });

      const approval = page.locator("[data-approval-actions]");
      await expect(approval).toHaveCount(1, { timeout: 30_000 });
      await approval.locator("[data-approve-action]").click();
      await waitForTaskStatus(page, created.id, "done");

      await expect
        .poll(
          async () => {
            const tasks = await rpc<
              Array<{
                id: string;
                parentTaskId?: string | null;
                model: string;
                policySnapshot?: { approvalMode?: string };
              }>
            >(page, "tasks.list", {});
            const follow = tasks.find(
              (task) =>
                task.parentTaskId === created.id &&
                task.id !== created.id,
            );
            if (!follow) return "missing";
            if (follow.model !== "fake-fast") return `model:${follow.model}`;
            if (follow.policySnapshot?.approvalMode !== "strict") {
              return `approval:${follow.policySnapshot?.approvalMode}`;
            }
            return "ok";
          },
          { timeout: 45_000, intervals: [250, 500, 1_000] },
        )
        .toBe("ok");

      expect(dialogs.count()).toBe(0);
    } finally {
      await desk.close();
    }
  });
});
