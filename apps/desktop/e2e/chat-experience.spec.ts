import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import type { Task, TaskEvent } from "@grokdesk/shared";
import { classifyBalancedShellCommand } from "../../../packages/shared/src/safe-shell-command";
import { parseStreamingJsonLine } from "../../../packages/engine-grok/src/events";
import { projectConversation } from "../src/renderer/lib/conversation-projector";
import { REFINED_CHAT_TRACE } from "./fixtures/scenarios";

const taskId = "trace-task";
const startedAt = "2026-08-05T12:00:00.000Z";
const desktopRoot = process.cwd();
const mainEntry = path.join(desktopRoot, "out/main/index.js");

type RpcResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

async function rpc<T>(
  page: Page,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await page.evaluate(
    ({ method, params }) =>
      window.grokdesk.request({
        id: `chat-experience-${Date.now()}-${Math.random()}`,
        method,
        params,
      }) as Promise<RpcResponse<unknown>>,
    { method, params },
  );
  if (!response.ok) throw new Error(response.error);
  return response.result as T;
}

async function waitForGateway(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.grokdesk.gatewayStatus()), {
      timeout: 60_000,
      intervals: [100, 250, 500, 1_000],
    })
    .toBe("ready");
}

async function waitForTaskStatus(
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

async function closeElectron(app: ElectronApplication): Promise<void> {
  await app.close();
}

function seedSyntheticAuth(home: string): void {
  const directory = path.join(home, ".grok");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "auth.json"),
    JSON.stringify({
      "https://auth.x.ai::client": {
        email: "chat-experience@grokdesk.local",
        first_name: "Chat",
        last_name: "Experience",
        refresh_token: "isolated-e2e-token",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
    }),
  );
}

function task(status: Task["status"]): Task {
  return {
    id: taskId,
    goal: "Review the app and cite the source",
    title: "Refined chat trace",
    mode: "interactive",
    status,
    model: "grok",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: ["/workspace"],
      allowNetworkTools: true,
      allowShell: true,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    attachments: [],
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: startedAt,
    updatedAt: "2026-08-05T12:00:10.000Z",
    completedAt:
      status === "done" ? "2026-08-05T12:00:10.000Z" : null,
  };
}

function event(
  seq: number,
  kind: TaskEvent["kind"],
  payload: Record<string, unknown>,
): TaskEvent {
  return {
    id: `trace-${seq}`,
    taskId,
    seq,
    kind,
    payload,
    createdAt: `2026-08-05T12:00:0${seq}.000Z`,
  };
}

test.describe("refined chat production trace", () => {
  test("quarantines protocol payloads and classifies terminal risk precisely", () => {
    expect(parseStreamingJsonLine(REFINED_CHAT_TRACE.nestedImageUpdate)).toEqual(
      [],
    );

    const [inspection] = parseStreamingJsonLine(
      REFINED_CHAT_TRACE.safeInspection,
    );
    expect(inspection).toMatchObject({
      type: "tool_request",
      tool: "shell",
      command: "git status --short",
    });
    expect(
      classifyBalancedShellCommand("git status --short", ["/workspace"]),
    ).toEqual({ safe: true, reason: "read_only" });
    expect(
      classifyBalancedShellCommand(REFINED_CHAT_TRACE.destructiveCommand, [
        "/workspace",
      ]).safe,
    ).toBe(false);
  });

  test("keeps one approval surface while narration stays out of the answer", () => {
    const snapshot = projectConversation({
      conversationId: taskId,
      title: null,
      tasks: [task("waiting_approval")],
      eventsByTask: {
        [taskId]: [
          event(1, "message", {
            role: "assistant",
            channel: "text",
            text: REFINED_CHAT_TRACE.narration,
          }),
          event(2, "approval_required", {
            approvalId: "destructive-approval",
            reason: "Remove generated preview files?",
            command: REFINED_CHAT_TRACE.destructiveCommand,
          }),
        ],
      },
    });

    expect(snapshot.needsUserAction).toBe(true);
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]?.approval?.approvalId).toBe(
      "destructive-approval",
    );
    expect(snapshot.turns[0]?.liveSummary).toBe(
      REFINED_CHAT_TRACE.narration,
    );
    expect(snapshot.turns[0]?.answer).toBeNull();
  });

  test("settles into a clean linked answer after approval", () => {
    const snapshot = projectConversation({
      conversationId: taskId,
      title: null,
      tasks: [task("done")],
      eventsByTask: {
        [taskId]: [
          event(1, "message", {
            role: "assistant",
            channel: "text",
            text: JSON.stringify({
              type: "tool_call_update",
              content: [{ type: "image", data: "A".repeat(4_096) }],
            }),
          }),
          event(2, "approval_required", {
            approvalId: "destructive-approval",
            reason: "Remove generated preview files?",
          }),
          event(3, "approval_resolved", {
            approvalId: "destructive-approval",
            decision: "reject",
          }),
          event(4, "message", {
            role: "assistant",
            channel: "text",
            terminal: true,
            text: REFINED_CHAT_TRACE.finalAnswer,
          }),
          event(5, "citations", { items: [REFINED_CHAT_TRACE.citation] }),
        ],
      },
    });

    const turn = snapshot.turns[0];
    expect(turn?.answer?.text).toBe(REFINED_CHAT_TRACE.finalAnswer);
    expect(turn?.answer?.text).not.toContain("tool_call_update");
    expect(turn?.approval).toBeNull();
    expect(turn?.citations).toEqual([REFINED_CHAT_TRACE.citation]);
    expect(turn?.answer?.text).toContain("](https://");
  });

  test("drives approval, durable final, and link opening through the real app", async () => {
    test.setTimeout(150_000);
    expect(fs.existsSync(mainEntry), `missing build: ${mainEntry}`).toBe(true);

    const profile = fs.mkdtempSync(
      path.join(os.tmpdir(), "grokdesk-chat-experience-"),
    );
    const gatewayDir = path.join(profile, "gateway");
    const workspace = path.join(profile, "workspace");
    fs.mkdirSync(gatewayDir, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    seedSyntheticAuth(profile);

    const app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${profile}`],
      cwd: desktopRoot,
      env: {
        ...process.env,
        GROKDESK_E2E: "1",
        GROKDESK_PROVIDER_ENGINE: "1",
        GROKDESK_PROVIDER_ID: "fake",
        GROKDESK_DATA_DIR: gatewayDir,
        GROKDESK_NODE_PATH: process.execPath,
        GROKDESK_SKIP_BROWSER_LOGIN: "1",
        HOME: profile,
        USERPROFILE: profile,
      },
      timeout: 60_000,
    });

    try {
      const page = await app.firstWindow({ timeout: 60_000 });
      await page.setViewportSize({ width: 1360, height: 900 });
      await page.waitForLoadState("domcontentloaded");
      await waitForGateway(page);

      await rpc(page, "settings.set", {
        onboardingCompleted: true,
        defaultApprovalMode: "strict",
        trustedFolders: [workspace],
      });
      await page.evaluate((ws) => {
        localStorage.setItem("grokdesk.lastWorkspaceRoot", ws);
        localStorage.setItem("grokdesk.productTour.completed.v1", "1");
        localStorage.setItem("grokdesk.whatsNew.seen.v1", "99.0.0");
      }, workspace);
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await waitForGateway(page);

      const created = await rpc<{ id: string }>(page, "tasks.create", {
        goal: "Prepare a concise launch brief with one linked source",
        workspaceRoots: [workspace],
        model: "fake-fast",
        effort: "normal",
        approvalMode: "strict",
        allowNetworkTools: true,
        clientMutationId: "refined-chat-real-app",
        locale: "en",
      });
      await waitForTaskStatus(page, created.id, "waiting_approval");

      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await waitForGateway(page);
      const chatRow = page.locator(".chat-row > button").first();
      await expect(chatRow).toBeVisible({ timeout: 30_000 });
      await chatRow.click();

      const approval = page.locator("[data-approval-actions]");
      await expect(approval).toHaveCount(1, { timeout: 30_000 });
      await approval.locator("[data-approve-action]").click();
      await waitForTaskStatus(page, created.id, "done");

      // Reload proves the final came from durable turn reconciliation rather
      // than only the transient event stream.
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await waitForGateway(page);
      if ((await page.locator("[data-assistant-answer]").count()) === 0) {
        await page.locator(".chat-row > button").first().click();
      }

      const answer = page.locator("[data-assistant-answer]").last();
      await expect(answer).toContainText("Your launch brief is ready", {
        timeout: 30_000,
      });
      await expect(answer).not.toContainText("tool_call_update");

      await answer
        .getByRole("link", { name: "Electron security guide" })
        .first()
        .click();
      await expect(page.locator('[data-browser-open="true"]')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator("[data-browser-pane]")).toBeVisible({
        timeout: 30_000,
      });
      const expectedUrl =
        "https://www.electronjs.org/docs/latest/tutorial/security";
      await expect(page.locator("[data-browser-pane]")).toHaveAttribute(
        "data-browser-url",
        expectedUrl,
        { timeout: 30_000 },
      );
      await expect
        .poll(
          async () => {
            const events = await rpc<TaskEvent[]>(page, "events.list", {
              taskId: created.id,
              afterSeq: 0,
            });
            return events.some(
              (event) =>
                event.kind === "tool_result" &&
                event.payload.tool === "browser_open" &&
                event.payload.ok === true &&
                event.payload.browserProvider === "desk-browser",
            );
          },
          { timeout: 30_000, intervals: [100, 250, 500] },
        )
        .toBe(true);
    } finally {
      await closeElectron(app);
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
});
