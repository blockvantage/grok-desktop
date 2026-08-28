/**
 * DoD #4 Playwright journeys on the fake provider:
 * mid-conversation model change, Waiting on you, deep-research panel,
 * image and video in the workspace, conversation search, plain-language 429 banner.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  launchIsolatedDesk,
  openFirstChat,
  rpc,
  waitForGateway,
  waitForTaskStatus,
} from "./fixtures/electron-desk";

const LAUNCH_BRIEF = "Prepare a concise launch brief with one linked source";

async function createTask(
  desk: Awaited<ReturnType<typeof launchIsolatedDesk>>,
  goal: string,
  mutationId: string,
) {
  return rpc<{ id: string }>(desk.page, "tasks.create", {
    goal,
    workspaceRoots: [desk.workspaceDir],
    model: "fake-fast",
    effort: "normal",
    approvalMode: "strict",
    allowNetworkTools: true,
    clientMutationId: mutationId,
    locale: "en",
  });
}

test.describe("flagship non-coder journeys", () => {
  test("Waiting on you inbox opens the parked approval", async () => {
    test.setTimeout(150_000);
    const desk = await launchIsolatedDesk({ prefix: "grokdesk-journey-inbox-" });
    try {
      const created = await createTask(desk, LAUNCH_BRIEF, "journey-inbox");
      await waitForTaskStatus(desk.page, created.id, "waiting_approval");
      await desk.page.reload();
      await desk.page.waitForLoadState("domcontentloaded");
      await waitForGateway(desk.page);

      await expect(desk.page.getByTestId("needs-you-open")).toBeVisible({
        timeout: 30_000,
      });
      await desk.page.getByTestId("inbox-view-all").click();
      await expect(desk.page.getByTestId("inbox-row").first()).toBeVisible({
        timeout: 15_000,
      });
      await desk.page
        .getByTestId("inbox-row")
        .first()
        .getByRole("button", { name: /open chat/i })
        .click();
      await expect(desk.page.locator("[data-approval-actions]")).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await desk.close();
    }
  });

  test("mid-conversation model change shows Next reply will use", async () => {
    test.setTimeout(150_000);
    const desk = await launchIsolatedDesk({ prefix: "grokdesk-journey-model-" });
    try {
      const created = await createTask(desk, LAUNCH_BRIEF, "journey-model");
      await waitForTaskStatus(desk.page, created.id, "waiting_approval");
      await desk.page.reload();
      await waitForGateway(desk.page);
      await openFirstChat(desk.page);

      await expect(desk.page.getByTestId("next-reply-will-use")).toBeVisible({
        timeout: 15_000,
      });
      const catalog = await rpc<{ models?: string[] }>(
        desk.page,
        "models.list",
        {},
      );
      expect(catalog.models ?? []).toContain("fake-heavy");

      await desk.page.getByTestId("composer-run-options").click();
      await desk.page.getByTestId("composer-model-trigger").click();
      await desk.page.getByRole("option", { name: "fake-heavy" }).click();
      await expect(desk.page.getByTestId("next-reply-will-use")).toContainText(
        "fake-heavy",
        { timeout: 10_000 },
      );
    } finally {
      await desk.close();
    }
  });

  test("deep-research goal renders the workflow panel", async () => {
    test.setTimeout(150_000);
    const desk = await launchIsolatedDesk({
      prefix: "grokdesk-journey-research-",
    });
    try {
      await expect(desk.page.getByTestId("home-research-deeply")).toBeVisible({
        timeout: 30_000,
      });
      const created = await createTask(
        desk,
        "/deep-research the competitor landscape",
        "journey-research",
      );
      await waitForTaskStatus(desk.page, created.id, "done");
      await desk.page.reload();
      await waitForGateway(desk.page);
      await openFirstChat(desk.page);
      await expect(desk.page.getByTestId("workflow-run-panel")).toBeVisible({
        timeout: 30_000,
      });
      await expect(desk.page.getByTestId("workflow-phases")).toContainText(
        "Gather",
      );
    } finally {
      await desk.close();
    }
  });

  test("image goal lands a PNG in the workspace folder", async () => {
    test.setTimeout(150_000);
    const desk = await launchIsolatedDesk({ prefix: "grokdesk-journey-media-" });
    try {
      await expect(desk.page.getByTestId("home-create-image")).toBeVisible({
        timeout: 30_000,
      });
      const created = await createTask(
        desk,
        "/image a red square",
        "journey-media",
      );
      await waitForTaskStatus(desk.page, created.id, "done");
      const png = path.join(desk.workspaceDir, "images", "fake-studio.png");
      expect(fs.existsSync(png), png).toBe(true);
    } finally {
      await desk.close();
    }
  });

  test("video goal lands an mp4 in the workspace folder", async () => {
    test.setTimeout(150_000);
    const desk = await launchIsolatedDesk({ prefix: "grokdesk-journey-video-" });
    try {
      await expect(desk.page.getByTestId("home-create-video")).toBeVisible({
        timeout: 30_000,
      });
      const created = await createTask(
        desk,
        "/video a short clip",
        "journey-video",
      );
      await waitForTaskStatus(desk.page, created.id, "done");
      const mp4 = path.join(desk.workspaceDir, "videos", "fake-studio.mp4");
      expect(fs.existsSync(mp4), mp4).toBe(true);
    } finally {
      await desk.close();
    }
  });

  test("conversation search finds the created chat", async () => {
    test.setTimeout(150_000);
    const desk = await launchIsolatedDesk({
      prefix: "grokdesk-journey-search-",
    });
    try {
      const created = await createTask(desk, LAUNCH_BRIEF, "journey-search");
      await waitForTaskStatus(desk.page, created.id, "waiting_approval");
      await expect(desk.page.locator(".chat-row > button").first()).toBeVisible({
        timeout: 30_000,
      });
      const hits = await rpc<{
        hits?: Array<{ title?: string; sessionId?: string }>;
      }>(desk.page, "sessions.search", { query: "launch brief" });
      expect(
        (hits.hits ?? []).some(
          (h) =>
            (h.title ?? "").toLowerCase().includes("launch") ||
            h.sessionId === created.id,
        ),
      ).toBe(true);

      await desk.page.keyboard.press(
        process.platform === "darwin" ? "Meta+k" : "Control+k",
      );
      await expect(desk.page.getByTestId("command-palette")).toBeVisible({
        timeout: 15_000,
      });
      await desk.page.keyboard.type("launch brief");
      await expect(
        desk.page.getByTestId("session-search-hit").first(),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await desk.close();
    }
  });

  test("429 capacity error is a plain-language banner, not JSON", async () => {
    test.setTimeout(150_000);
    const desk = await launchIsolatedDesk({ prefix: "grokdesk-journey-429-" });
    try {
      const created = await createTask(
        desk,
        "HTTP 429 capacity overloaded",
        "journey-429",
      );
      await waitForTaskStatus(desk.page, created.id, "failed");
      await desk.page.reload();
      await waitForGateway(desk.page);
      // Failed chats live under Needs review, not the primary rail.
      await desk.page.getByRole("button", { name: /needs review/i }).click();
      await openFirstChat(desk.page);
      const banner = desk.page.getByTestId("recovery-banner");
      await expect(banner).toBeVisible({ timeout: 30_000 });
      const text = await banner.innerText();
      expect(text.toLowerCase()).toMatch(/capacity|try again|busy|limit/);
      expect(text).not.toMatch(/\{"error"|jsonrpc|stack trace/i);
    } finally {
      await desk.close();
    }
  });
});
