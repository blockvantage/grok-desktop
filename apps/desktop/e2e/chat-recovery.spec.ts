/**
 * Chat recovery journeys: gateway crash/restart, missing-attachment re-pick,
 * retry of a blocked outbox row.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { assertNoRealProfileEnv, createTempTestProfile } from "./fixtures/test-profile";
import {
  crashGateway,
  launchIsolatedDesk,
  openFirstChat,
  rpc,
  waitForGateway,
  waitForTaskStatus,
  watchNativeDialogs,
} from "./fixtures/electron-desk";

test.describe("chat recovery harness", () => {
  test("recovery harness uses temp profile only", () => {
    assertNoRealProfileEnv();
    const p = createTempTestProfile("grokdesk-recovery-");
    expect(p.userDataDir).toContain("grokdesk-recovery-");
    p.cleanup();
  });
});

test.describe("chat recovery journeys", () => {
  test("survives gateway crash and recovers a missing attachment", async () => {
    test.setTimeout(150_000);
    const desk = await launchIsolatedDesk({ prefix: "grokdesk-chat-recovery-" });
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
        clientMutationId: "recovery-root",
        locale: "en",
      });
      await waitForTaskStatus(page, created.id, "waiting_approval");

      const missingPath = path.join(
        workspaceDir,
        "does-not-exist-yet",
        "vanished.txt",
      );
      const queued = await rpc<{
        outcome: string;
        item: { id: string };
      }>(page, "outbox.enqueue", {
        id: "recovery-missing-att",
        conversationId: created.id,
        parentTaskId: created.id,
        text: "Attach the vanished notes once they are back.",
        attachments: [
          {
            id: "att-missing",
            name: "vanished.txt",
            sourcePath: missingPath,
            kind: "file",
          },
        ],
      });
      expect(queued.outcome).toBe("accepted");

      await crashGateway(page);
      const crashStarted = Date.now();
      while (Date.now() - crashStarted < 8_000) {
        const status = await page.evaluate(() =>
          window.grokdesk.gatewayStatus(),
        );
        if (status !== "ready") break;
        await page.waitForTimeout(100);
      }
      try {
        await waitForGateway(page);
      } catch {
        await page.evaluate(async () => {
          const grok = window.grokdesk;
          if (!grok.restartGateway) throw new Error("restartGateway missing");
          const r = await grok.restartGateway();
          if (r && r.ok === false) {
            throw new Error(r.error ?? "restartGateway failed");
          }
        });
        await waitForGateway(page);
      }

      const afterCrash = await rpc<{ id: string; status: string }>(
        page,
        "tasks.get",
        { taskId: created.id },
      );
      expect(afterCrash.id).toBe(created.id);
      expect(afterCrash.status).toBeTruthy();
      const stillQueued = await rpc<Array<{ id: string; text: string }>>(
        page,
        "outbox.list",
        { conversationId: created.id, includeTerminal: true },
      );
      expect(
        stillQueued.some((item) => item.id === "recovery-missing-att"),
      ).toBe(true);

      const fresh = await rpc<{ id: string }>(page, "tasks.create", {
        goal: "Prepare a concise launch brief with one linked source",
        workspaceRoots: [workspaceDir],
        model: "fake-fast",
        effort: "normal",
        approvalMode: "strict",
        allowNetworkTools: true,
        clientMutationId: "recovery-missing-root",
        locale: "en",
      });
      await waitForTaskStatus(page, fresh.id, "waiting_approval");
      const missingQueued = await rpc<{
        outcome: string;
        item: { id: string };
      }>(page, "outbox.enqueue", {
        id: "recovery-missing-att-fresh",
        conversationId: fresh.id,
        parentTaskId: fresh.id,
        text: "Attach the vanished notes once they are back.",
        attachments: [
          {
            id: "att-missing-fresh",
            name: "vanished.txt",
            sourcePath: missingPath,
            kind: "file",
          },
        ],
      });
      expect(missingQueued.outcome).toBe("accepted");
      await rpc(page, "tasks.setTitle", {
        taskId: fresh.id,
        title: "Missing-file recovery",
      });

      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await waitForGateway(page);
      const namedChat = page.getByRole("button", {
        name: /Missing-file recovery/,
      });
      if ((await namedChat.count()) > 0) {
        await namedChat.first().click();
        await expect(
          page.locator('[data-testid="workspace-sticky-composer"]'),
        ).toBeVisible({ timeout: 30_000 });
      } else {
        await openFirstChat(page);
      }

      const approval = page.locator("[data-approval-actions]");
      await expect(approval).toHaveCount(1, { timeout: 30_000 });
      await approval.locator("[data-approve-action]").click();
      await waitForTaskStatus(page, fresh.id, "done");

      await expect
        .poll(
          async () => {
            const list = await rpc<
              Array<{ id: string; status: string; failReason?: string | null }>
            >(page, "outbox.list", { conversationId: fresh.id });
            const item = list.find(
              (row) => row.id === "recovery-missing-att-fresh",
            );
            return item?.status ?? "missing";
          },
          { timeout: 30_000, intervals: [200, 400, 800] },
        )
        .toBe("blocked_missing_attachment");

      await expect(
        page.locator('[data-queue-fail-reason="missing_attachment"]'),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.locator(
          '[data-queue-repick-attachment="recovery-missing-att-fresh"]',
        ),
      ).toBeVisible();

      const restored = path.join(workspaceDir, "vanished.txt");
      fs.writeFileSync(restored, "notes restored\n");
      await rpc(page, "outbox.update", {
        id: "recovery-missing-att-fresh",
        attachments: [
          {
            id: "att-restored",
            name: "vanished.txt",
            sourcePath: restored,
            kind: "file",
          },
        ],
      });
      const retry = page.locator(
        '[data-queue-retry="recovery-missing-att-fresh"]',
      );
      if (await retry.isVisible()) await retry.click();

      await expect
        .poll(
          async () => {
            const tasks = await rpc<
              Array<{ id: string; parentTaskId?: string | null }>
            >(page, "tasks.list", {});
            return tasks.some(
              (task) =>
                task.parentTaskId === fresh.id && task.id !== fresh.id,
            );
          },
          { timeout: 45_000, intervals: [250, 500, 1_000] },
        )
        .toBe(true);

      expect(dialogs.count()).toBe(0);
    } finally {
      await desk.close();
    }
  });
});
