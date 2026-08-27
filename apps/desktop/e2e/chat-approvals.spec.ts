/**
 * Chat approval + undo journeys: owned confirm (no window.confirm), rewind
 * copy is conversation-only.
 */
import { test, expect } from "@playwright/test";
import { assertNoRealProfileEnv } from "./fixtures/test-profile";
import {
  launchIsolatedDesk,
  openFirstChat,
  rpc,
  waitForGateway,
  waitForTaskStatus,
  watchNativeDialogs,
} from "./fixtures/electron-desk";

test.describe("chat approvals harness", () => {
  test("approvals harness refuses real profiles", () => {
    expect(() => assertNoRealProfileEnv()).not.toThrow();
  });
});

test.describe("chat approvals journeys", () => {
  test("approve then undo through owned confirm, never a native dialog", async () => {
    test.setTimeout(150_000);
    const desk = await launchIsolatedDesk({ prefix: "grokdesk-chat-approvals-" });
    const { page, workspaceDir } = desk;
    const dialogs = watchNativeDialogs(page);

    try {
      const created = await rpc<{ id: string }>(page, "tasks.create", {
        goal: "Prepare a concise launch brief with one linked source",
        workspaceRoots: [workspaceDir],
        model: "fake-fast",
        effort: "normal",
        approvalMode: "strict",
        allowNetworkTools: true,
        clientMutationId: "approvals-root",
        locale: "en",
      });
      await waitForTaskStatus(page, created.id, "waiting_approval");

      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await waitForGateway(page);
      await openFirstChat(page);

      const approval = page.locator("[data-approval-actions]");
      await expect(approval).toHaveCount(1, { timeout: 30_000 });
      await expect(page.locator("[data-approve-action]")).toHaveCount(1);
      await approval.locator("[data-approve-action]").click();
      await waitForTaskStatus(page, created.id, "done");

      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await waitForGateway(page);
      if ((await page.locator("[data-assistant-answer]").count()) === 0) {
        await openFirstChat(page);
      }
      await expect(page.locator("[data-assistant-answer]").last()).toContainText(
        "Your launch brief is ready",
        { timeout: 30_000 },
      );

      const undo = page.locator("[data-undo-turn]").first();
      await expect(undo).toBeVisible({ timeout: 15_000 });
      await undo.click();

      const confirm = page.locator('[data-testid="owned-confirm"]');
      await expect(confirm).toBeVisible({ timeout: 15_000 });
      await expect(confirm).toContainText(
        "This rewinds the conversation. It does not restore files on disk.",
      );
      await confirm.getByRole("button", { name: /continue/i }).click();
      await expect(page.getByText("Turn undone")).toBeVisible({
        timeout: 15_000,
      });

      expect(dialogs.count()).toBe(0);
    } finally {
      await desk.close();
    }
  });
});
