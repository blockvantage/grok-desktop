import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { AuditService } from "./audit.js";
import { TaskRunner } from "./runner.js";
import { TestEngine } from "@grokdesk/engine-testkit";
import type { EngineAdapter, EngineRunOptions } from "@grokdesk/engine-grok";
import { parseStreamingJsonLine } from "../../../engine-grok/src/events.js";

describe("TaskRunner", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;
  let audit: AuditService;
  let runner: TaskRunner;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-run-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
    audit = new AuditService(db);
    runner = new TaskRunner(tasks, audit, new TestEngine());
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("runs fake engine to completion and writes artifact file (autopilot)", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "Write a note",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);
    expect(tasks.get(t.id)?.status).toBe("done");
    const out = path.join(ws, "grokdesk-output.md");
    expect(fs.existsSync(out)).toBe(true);
    const body = fs.readFileSync(out, "utf8");
    expect(body).toContain("Write a note");
  });

  it("balanced mode also allows write_file without approval", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "Balanced write",
      workspaceRoots: [ws],
      approvalMode: "balanced",
    });
    await runner.start(t.id);
    expect(tasks.get(t.id)?.status).toBe("done");
    expect(fs.existsSync(path.join(ws, "grokdesk-output.md"))).toBe(true);
  });

  it("does not host-execute a self-owned tool after the global engine is hot-swapped", async () => {
    const ws = path.join(dir, "ws-run-engine-ownership");
    fs.mkdirSync(ws);
    const output = path.join(ws, "provider-owned.txt");
    const selfOwnedEngine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(options) {
        runner.setEngine(new TestEngine());
        await options.onEvent({
          type: "tool_request",
          id: "provider-write",
          tool: "write_file",
          path: output,
          meta: { content: "must not be written by the host" },
        });
        await options.onEvent({ type: "done", summary: "provider finished" });
      },
    };
    runner = new TaskRunner(tasks, audit, selfOwnedEngine);
    const task = tasks.create({
      goal: "Keep tool ownership stable",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });

    await runner.start(task.id);

    expect(fs.existsSync(output)).toBe(false);
    expect(tasks.get(task.id)?.status).toBe("done");
  });

  it("reconciles the assistant turn before publishing done status", async () => {
    const calls: Array<{ taskId: string; status: string | undefined }> = [];
    runner = new TaskRunner(tasks, audit, new TestEngine(), {
      reconcileAssistantTurn: (taskId) => {
        calls.push({ taskId, status: tasks.get(taskId)?.status });
      },
    });
    const ws = path.join(dir, "ws-assistant-ledger");
    fs.mkdirSync(ws);
    const task = tasks.create({
      goal: "Persist my answer",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });

    await runner.start(task.id);

    expect(calls).toEqual([{ taskId: task.id, status: "running" }]);
    expect(tasks.get(task.id)?.status).toBe("done");
  });

  it("strict mode waits for approval then completes on approve", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "Needs approval",
      workspaceRoots: [ws],
      approvalMode: "strict",
    });

    const startPromise = runner.start(t.id);

    // Poll until waiting_approval
    let approvalId: string | undefined;
    for (let i = 0; i < 50; i++) {
      const pending = runner.getPendingApprovals(t.id);
      if (pending.length > 0) {
        approvalId = pending[0]!.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(approvalId).toBeTruthy();
    expect(tasks.get(t.id)?.status).toBe("waiting_approval");

    await runner.approve(approvalId!, "approve");
    await startPromise;

    expect(tasks.get(t.id)?.status).toBe("done");
    expect(fs.existsSync(path.join(ws, "grokdesk-output.md"))).toBe(true);
  });

  it("cancel while waiting for approval appends approval_resolved", async () => {
    const ws = path.join(dir, "ws-cancel-appr");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "Cancel mid-approval",
      workspaceRoots: [ws],
      approvalMode: "strict",
    });

    const startPromise = runner.start(t.id);

    let approvalId: string | undefined;
    for (let i = 0; i < 50; i++) {
      const pending = runner.getPendingApprovals(t.id);
      if (pending.length > 0) {
        approvalId = pending[0]!.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(approvalId).toBeTruthy();
    expect(tasks.get(t.id)?.status).toBe("waiting_approval");

    await runner.cancel(t.id);
    await startPromise;

    expect(tasks.get(t.id)?.status).toBe("cancelled");
    expect(runner.getPendingApprovals(t.id)).toHaveLength(0);
    const kinds = tasks.listEvents(t.id).map((e) => e.kind);
    expect(kinds).toContain("approval_required");
    expect(kinds).toContain("approval_resolved");
    const resolved = tasks
      .listEvents(t.id)
      .find((e) => e.kind === "approval_resolved");
    expect(resolved?.payload).toMatchObject({
      approvalId,
      decision: "reject",
      reason: "cancelled",
    });
  });

  it("marks failed when engine exits while parked on approval", async () => {
    const sticky: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(opts: EngineRunOptions) {
        // Kick off the approval park without awaiting it (CLI process would exit).
        void opts.onEvent({
          type: "tool_request",
          id: "req-1",
          tool: "write_file",
          path: path.join(opts.task.policySnapshot.workspaceRoots[0]!, "x.md"),
          meta: { content: "hi" },
        });
        // Allow handleEvent to flip status → waiting_approval before run returns.
        await new Promise((r) => setTimeout(r, 40));
      },
    };
    runner = new TaskRunner(tasks, audit, sticky);
    const ws = path.join(dir, "ws-abandon");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "Needs approval then crash",
      workspaceRoots: [ws],
      approvalMode: "strict",
    });
    await runner.start(t.id);
    expect(tasks.get(t.id)?.status).toBe("failed");
    const kinds = tasks.listEvents(t.id).map((e) => e.kind);
    expect(kinds).toContain("error");
  });

  it("harvests workspace files as artifacts when engine writes without artifact events", async () => {
    const silent: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(opts: EngineRunOptions) {
        const root = opts.task.policySnapshot.workspaceRoots[0]!;
        const out = path.join(root, "brief.md");
        fs.writeFileSync(out, "# Campaign brief\n\nShip it.\n");
        await opts.onEvent({
          type: "message",
          role: "assistant",
          text: "thinking…",
          channel: "thought",
        });
        await opts.onEvent({ type: "done", summary: "Grok Build completed" });
      },
    };
    runner = new TaskRunner(tasks, audit, silent);
    const ws = path.join(dir, "ws-harvest");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "Write a brief",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);
    expect(tasks.get(t.id)?.status).toBe("done");
    const arts = tasks
      .listEvents(t.id)
      .filter((e) => e.kind === "artifact_created");
    expect(arts.length).toBe(1);
    expect(String(arts[0]!.payload.path)).toContain("brief.md");
    // Junk lifecycle summary must not appear as assistant message
    const msgs = tasks
      .listEvents(t.id)
      .filter((e) => e.kind === "message")
      .map((e) => String(e.payload.text ?? ""));
    expect(msgs.some((m) => /Grok Build completed/i.test(m))).toBe(false);
  });

  it("harvests only primary root, not secondary project files", async () => {
    const silent: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(opts: EngineRunOptions) {
        const primary = opts.task.policySnapshot.workspaceRoots[0]!;
        fs.writeFileSync(path.join(primary, "made-by-grok.md"), "hi");
        await opts.onEvent({ type: "done", summary: "ok" });
      },
    };
    runner = new TaskRunner(tasks, audit, silent);
    const primary = path.join(dir, "primary-h");
    const project = path.join(dir, "project-h");
    fs.mkdirSync(primary);
    fs.mkdirSync(project);
    const old = path.join(project, "old-readme.md");
    fs.writeFileSync(old, "pre-existing");
    const now = new Date();
    fs.utimesSync(old, now, now);
    const t = tasks.create({
      goal: "Write",
      workspaceRoots: [primary, project],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);
    const arts = tasks
      .listEvents(t.id)
      .filter((e) => e.kind === "artifact_created")
      .map((e) => path.basename(String(e.payload.path)));
    expect(arts).toContain("made-by-grok.md");
    expect(arts).not.toContain("old-readme.md");
  });

  it("does not harvest user-staged files under primary/attachments", async () => {
    const silent: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(opts: EngineRunOptions) {
        const primary = opts.task.policySnapshot.workspaceRoots[0]!;
        // Grok creates a real deliverable outside attachments/
        fs.writeFileSync(path.join(primary, "made-by-grok.md"), "done");
        await opts.onEvent({ type: "done", summary: "ok" });
      },
    };
    runner = new TaskRunner(tasks, audit, silent);
    const primary = path.join(dir, "primary-att");
    fs.mkdirSync(primary);
    const attDir = path.join(primary, "attachments");
    fs.mkdirSync(attDir);
    // Simulate user-staged image (mtime = now, same window as the run)
    const photo = path.join(attDir, "photo.png");
    fs.writeFileSync(photo, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const now = new Date();
    fs.utimesSync(photo, now, now);

    const t = tasks.create({
      goal: "Use the photo",
      workspaceRoots: [primary],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);
    const arts = tasks
      .listEvents(t.id)
      .filter((e) => e.kind === "artifact_created")
      .map((e) => path.basename(String(e.payload.path)));
    expect(arts).toContain("made-by-grok.md");
    expect(arts).not.toContain("photo.png");
    // Nothing under attachments/ should appear as a deliverable path
    const paths = tasks
      .listEvents(t.id)
      .filter((e) => e.kind === "artifact_created")
      .map((e) => String(e.payload.path));
    expect(paths.every((p) => !p.includes(`${path.sep}attachments${path.sep}`))).toBe(
      true,
    );
  });

  it("does not harvest attachments when Grok writes nothing", async () => {
    const silent: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(opts: EngineRunOptions) {
        await opts.onEvent({
          type: "message",
          role: "assistant",
          text: "All good, used your photo.",
        });
        await opts.onEvent({ type: "done", summary: "ok" });
      },
    };
    runner = new TaskRunner(tasks, audit, silent);
    const primary = path.join(dir, "primary-att-only");
    fs.mkdirSync(primary);
    const attDir = path.join(primary, "attachments");
    fs.mkdirSync(attDir);
    fs.writeFileSync(
      path.join(attDir, "photo.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    const t = tasks.create({
      goal: "Describe photo",
      workspaceRoots: [primary],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);
    const arts = tasks
      .listEvents(t.id)
      .filter((e) => e.kind === "artifact_created");
    expect(arts).toHaveLength(0);
  });

  it("persists parsed worker events unchanged without changing primary lifecycle", async () => {
    const envelopes = [
      {
        type: "subagent_started",
        subagent_id: "w1",
        label: "Research",
        objective: "Find evidence",
      },
      {
        type: "subagent_activity",
        subagent_id: "w1",
        summary: "Reading sources",
      },
      {
        type: "subagent_message",
        subagent_id: "w1",
        text: "Found three sources",
      },
      {
        type: "subagent_completed",
        subagent_id: "w1",
        summary: "Research complete",
      },
      {
        type: "subagent_failed",
        subagent_id: "w2",
        summary: "Connector unavailable",
      },
    ];
    const callbackResults: Array<"continue" | "abort"> = [];
    const workerEngine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(options: EngineRunOptions) {
        for (const envelope of envelopes) {
          const [event] = parseStreamingJsonLine(JSON.stringify(envelope));
          if (event) callbackResults.push(await options.onEvent(event));
        }
      },
    };
    runner = new TaskRunner(tasks, audit, workerEngine);
    const ws = path.join(dir, "ws-workers");
    fs.mkdirSync(ws);
    const task = tasks.create({
      goal: "Research with workers",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });

    await runner.start(task.id);

    expect(callbackResults).toEqual([
      "continue",
      "continue",
      "continue",
      "continue",
      "continue",
    ]);
    expect(tasks.get(task.id)?.status).toBe("done");
    const workerEvents = tasks
      .listEvents(task.id)
      .filter((event) => event.kind.startsWith("worker_"));
    expect(workerEvents.map(({ kind, payload }) => ({ kind, payload }))).toEqual([
      {
        kind: "worker_started",
        payload: {
          workerId: "w1",
          label: "Research",
          objective: "Find evidence",
        },
      },
      {
        kind: "worker_activity",
        payload: { workerId: "w1", summary: "Reading sources" },
      },
      {
        kind: "worker_message",
        payload: { workerId: "w1", text: "Found three sources" },
      },
      {
        kind: "worker_completed",
        payload: { workerId: "w1", summary: "Research complete" },
      },
      {
        kind: "worker_failed",
        payload: { workerId: "w2", summary: "Connector unavailable" },
      },
    ]);
    expect(
      tasks
        .listEvents(task.id)
        .some((event) => event.kind === "error" || event.kind === "message"),
    ).toBe(false);
  });

  function mockHost(execLog: unknown[]) {
    return {
      async browserExec(req: unknown) {
        execLog.push(req);
        const r = req as { tool?: string; args?: { url?: string } };
        if (r.args?.url?.startsWith("file:")) {
          return { ok: false, output: "file:// URLs are not allowed" };
        }
        return {
          ok: true,
          output: "loaded",
          url: "https://example.com",
        };
      },
      async browserConfigure() {},
      async browserRememberOrigin() {},
      async browserResolveApproval() {
        return true;
      },
      async browserDestroy() {},
      async desktopExec() {
        return { ok: false, output: "mock" };
      },
      async desktopConfigure() {},
      async desktopGetStatus() {
        return null;
      },
      async desktopDestroy() {},
      async desktopPermissions() {
        return {
          captureGranted: false,
          inputGranted: false,
          captureDetail: "mock",
          inputDetail: "mock",
          platform: "other" as const,
        };
      },
    };
  }

  it("runs browser_open through host bridge under autopilot", async () => {
    const calls: unknown[] = [];
    class BrowserOpenEngine implements EngineAdapter {
      readonly executesOwnTools = false;
      async cancel(): Promise<void> {}
      async run(options: EngineRunOptions): Promise<void> {
        await options.onEvent({
          type: "tool_request",
          id: "b1",
          tool: "browser_open",
          meta: { url: "https://example.com" },
        });
        await options.onEvent({ type: "done", summary: "opened" });
      }
    }
    runner = new TaskRunner(tasks, audit, new BrowserOpenEngine(), {
      hostBridge: mockHost(calls),
    });
    const ws = path.join(dir, "ws-browser");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "Browse",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);
    expect(calls).toHaveLength(1);
    expect(tasks.get(t.id)?.status).toBe("done");
    const results = tasks
      .listEvents(t.id)
      .filter((e) => e.kind === "tool_result");
    expect(results.some((e) => e.payload.ok === true)).toBe(true);
  });

  it("retains a confirmed host-mediated open and skips fallback harvest", async () => {
    const execCalls: Array<{ tool: string }> = [];
    const destroyCalls: string[] = [];
    const engine: EngineAdapter = {
      executesOwnTools: false,
      async cancel() {},
      async run(options) {
        fs.writeFileSync(
          path.join(
            options.task.policySnapshot.workspaceRoots[0]!,
            "index.html",
          ),
          "<h1>Harvest must not reopen this</h1>",
        );
        await options.onEvent({
          type: "tool_request",
          id: "host-open",
          tool: "browser_open",
          meta: { url: "https://example.com" },
        });
        await options.onEvent({ type: "done", summary: "opened" });
      },
    };
    const host = mockHost([]);
    runner = new TaskRunner(tasks, audit, engine, {
      hostBridge: {
        ...host,
        async browserExec(req) {
          execCalls.push(req);
          return execCalls.length === 1
            ? {
                ok: true,
                output: "loaded remote",
                url: "https://example.com",
              }
            : { ok: false, output: "unexpected fallback" };
        },
        async browserDestroy(taskId) {
          destroyCalls.push(taskId);
        },
      },
    });
    const ws = path.join(dir, "ws-host-confirmed-open");
    fs.mkdirSync(ws);
    const task = tasks.create({
      goal: "Open remote site",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });

    await runner.start(task.id);

    expect(execCalls).toHaveLength(1);
    expect(destroyCalls).toHaveLength(0);
    const result = tasks
      .listEvents(task.id)
      .find(
        (event) =>
          event.kind === "tool_result" && event.payload.id === "host-open",
      );
    expect(result?.payload).toMatchObject({
      id: "host-open",
      tool: "browser_open",
      ok: true,
      browserProvider: "desk-browser",
    });
  });

  it("destroys desktop host grant after run even when browser pane is retained", async () => {
    // Safety: keeping the agent browser for the user must not leave desk-desktop
    // granted/active on the host while the engine is idle.
    const browserDestroyCalls: string[] = [];
    const desktopDestroyCalls: string[] = [];
    const engine: EngineAdapter = {
      executesOwnTools: false,
      async cancel() {},
      async run(options) {
        await options.onEvent({
          type: "tool_request",
          id: "host-open",
          tool: "browser_open",
          meta: { url: "https://example.com" },
        });
        await options.onEvent({ type: "done", summary: "opened" });
      },
    };
    const host = mockHost([]);
    runner = new TaskRunner(tasks, audit, engine, {
      hostBridge: {
        ...host,
        async browserExec() {
          return {
            ok: true,
            output: "loaded",
            url: "https://example.com",
          };
        },
        async browserDestroy(taskId) {
          browserDestroyCalls.push(taskId);
        },
        async desktopDestroy(taskId) {
          desktopDestroyCalls.push(taskId);
        },
      },
    });
    const ws = path.join(dir, "ws-desktop-destroy-keep-browser");
    fs.mkdirSync(ws);
    const task = tasks.create({
      goal: "Open remote site with desktop grant",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    runner.setDesktopGrant(task.id, true, "main");

    await runner.start(task.id);

    expect(tasks.get(task.id)?.status).toBe("done");
    // Browser retained for the user after confirmed open.
    expect(browserDestroyCalls).toHaveLength(0);
    // Desktop host must still be torn down so idle MCP cannot inject input.
    expect(desktopDestroyCalls).toEqual([task.id]);
    // Grant preference for the chat root remains for the next run start.
    expect(runner.getDesktopGrant(task.id).granted).toBe(true);
  });

  it("does not retain host-mediated browser failures or successful reads", async () => {
    const cases = [
      { id: "failed-open", tool: "browser_open", ok: false },
      { id: "successful-read", tool: "browser_read", ok: true },
    ] as const;
    for (const testCase of cases) {
      const destroyCalls: string[] = [];
      const engine: EngineAdapter = {
        executesOwnTools: false,
        async cancel() {},
        async run(options) {
          await options.onEvent({
            type: "tool_request",
            id: testCase.id,
            tool: testCase.tool,
            meta:
              testCase.tool === "browser_open"
                ? { url: "https://blocked.example" }
                : undefined,
          });
          await options.onEvent({ type: "done", summary: "done" });
        },
      };
      const host = mockHost([]);
      runner = new TaskRunner(tasks, audit, engine, {
        hostBridge: {
          ...host,
          async browserExec() {
            return {
              ok: testCase.ok,
              output: testCase.ok ? "read" : "navigation denied",
            };
          },
          async browserDestroy(taskId) {
            destroyCalls.push(taskId);
          },
        },
      });
      const ws = path.join(dir, `ws-host-${testCase.id}`);
      fs.mkdirSync(ws);
      const task = tasks.create({
        goal: testCase.id,
        workspaceRoots: [ws],
        approvalMode: "autopilot",
      });

      await runner.start(task.id);

      expect(destroyCalls).toEqual([task.id]);
      const result = tasks
        .listEvents(task.id)
        .find(
          (event) =>
            event.kind === "tool_result" &&
            event.payload.id === testCase.id,
        );
      expect(result?.payload).toMatchObject({
        tool: testCase.tool,
        ok: testCase.ok,
      });
      expect(result?.payload.browserProvider).toBe(
        testCase.ok ? "desk-browser" : undefined,
      );
    }
  });

  it("denies file:// browser_open via host policy result", async () => {
    const calls: unknown[] = [];
    class FileBrowserEngine implements EngineAdapter {
      readonly executesOwnTools = false;
      async cancel(): Promise<void> {}
      async run(options: EngineRunOptions): Promise<void> {
        await options.onEvent({
          type: "tool_request",
          id: "b1",
          tool: "browser_open",
          meta: { url: "file:///etc/passwd" },
        });
        await options.onEvent({ type: "done", summary: "done" });
      }
    }
    runner = new TaskRunner(tasks, audit, new FileBrowserEngine(), {
      hostBridge: mockHost(calls),
    });
    const ws = path.join(dir, "ws-file-browser");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "Bad url",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);
    // Host is sole policy owner — still invoked, returns ok:false
    expect(calls).toHaveLength(1);
    const results = tasks
      .listEvents(t.id)
      .filter((e) => e.kind === "tool_result");
    expect(results[0]?.payload.ok).toBe(false);
  });

  it("does not host-re-exec browser tools when engine executesOwnTools", async () => {
    const execCalls: unknown[] = [];
    const configureCalls: unknown[] = [];
    class OwnToolsBrowserEngine implements EngineAdapter {
      readonly executesOwnTools = true;
      async cancel(): Promise<void> {}
      async run(options: EngineRunOptions): Promise<void> {
        await options.onEvent({
          type: "tool_request",
          id: "b1",
          tool: "browser_open",
          meta: { url: "https://example.com" },
        });
        // Engine/MCP already produced a result
        await options.onEvent({
          type: "tool_result",
          id: "b1",
          ok: true,
          output: "mcp loaded",
        });
        await options.onEvent({ type: "done", summary: "done" });
      }
    }
    runner = new TaskRunner(tasks, audit, new OwnToolsBrowserEngine(), {
      hostBridge: {
        async browserExec(req) {
          execCalls.push(req);
          return { ok: true, output: "should not run" };
        },
        async browserConfigure(req) {
          configureCalls.push(req);
        },
        async browserRememberOrigin() {},
        async browserResolveApproval() {
          return false;
        },
        async browserDestroy() {},
        async desktopExec() {
          return { ok: false, output: "mock" };
        },
        async desktopConfigure() {},
        async desktopGetStatus() {
          return null;
        },
        async desktopDestroy() {},
        async desktopPermissions() {
          return {
            captureGranted: false,
            inputGranted: false,
            captureDetail: "mock",
            inputDetail: "mock",
            platform: "other" as const,
          };
        },
      },
    });
    const ws = path.join(dir, "ws-own-tools");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "Browse via MCP",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);
    expect(configureCalls.length).toBeGreaterThanOrEqual(1);
    expect(String((configureCalls[0] as { taskId: string }).taskId)).toBe(
      t.id,
    );
    expect(execCalls).toHaveLength(0);
    expect(tasks.get(t.id)?.status).toBe("done");
  });

  it("retains the browser and skips harvest after a confirmed direct MCP open", async () => {
    const execCalls: unknown[] = [];
    const destroyCalls: string[] = [];
    class DirectMcpOpenEngine implements EngineAdapter {
      readonly executesOwnTools = true;
      async cancel(): Promise<void> {}
      async run(options: EngineRunOptions): Promise<void> {
        const html = path.join(
          options.task.policySnapshot.workspaceRoots[0]!,
          "index.html",
        );
        fs.writeFileSync(html, "<h1>Already loaded by MCP</h1>");
        await options.onEvent({
          type: "tool_request",
          id: "open-local",
          tool: "browser_open",
          meta: { path: html },
        });
        await options.onEvent({
          type: "tool_request",
          id: "read-concurrent",
          tool: "browser_read",
        });
        // Results may arrive out of request order. Only the matching open
        // success is evidence that the pane has useful content.
        await options.onEvent({
          type: "tool_result",
          id: "read-concurrent",
          ok: false,
          output: "read unavailable",
        });
        await options.onEvent({
          type: "tool_result",
          id: "open-local",
          ok: true,
          output: "MCP loaded local page",
        });
        await options.onEvent({ type: "done", summary: "done" });
      }
    }
    const host = mockHost([]);
    runner = new TaskRunner(tasks, audit, new DirectMcpOpenEngine(), {
      hostBridge: {
        ...host,
        async browserExec(req) {
          execCalls.push(req);
          return { ok: false, output: "fallback must not run" };
        },
        async browserDestroy(taskId) {
          destroyCalls.push(taskId);
        },
      },
    });
    const ws = path.join(dir, "ws-direct-mcp-open");
    fs.mkdirSync(ws);
    const task = tasks.create({
      goal: "Open the local site in the browser",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });

    await runner.start(task.id);

    expect(execCalls).toHaveLength(0);
    expect(destroyCalls).toHaveLength(0);
    const results = tasks
      .listEvents(task.id)
      .filter((event) => event.kind === "tool_result");
    expect(results.find((event) => event.payload.id === "open-local")?.payload)
      .toMatchObject({
        id: "open-local",
        tool: "browser_open",
        ok: true,
        browserProvider: "desk-browser",
      });
    expect(
      results.find((event) => event.payload.id === "read-concurrent")?.payload
        .browserProvider,
    ).toBeUndefined();
  });

  it("retains the browser after a confirmed direct remote MCP open", async () => {
    const destroyCalls: string[] = [];
    const engine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(options) {
        await options.onEvent({
          type: "tool_request",
          id: "open-remote",
          tool: "browser_open",
          meta: { url: "https://example.com" },
        });
        await options.onEvent({
          type: "tool_result",
          id: "open-remote",
          ok: true,
          output: "MCP loaded remote page",
        });
        await options.onEvent({ type: "done", summary: "done" });
      },
    };
    const host = mockHost([]);
    runner = new TaskRunner(tasks, audit, engine, {
      hostBridge: {
        ...host,
        async browserDestroy(taskId) {
          destroyCalls.push(taskId);
        },
      },
    });
    const ws = path.join(dir, "ws-direct-remote-open");
    fs.mkdirSync(ws);
    const task = tasks.create({
      goal: "Open the remote site",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });

    await runner.start(task.id);

    expect(destroyCalls).toHaveLength(0);
  });

  it("does not retain the browser for failed or unresolved direct MCP requests", async () => {
    const destroyCalls: string[] = [];
    const fallbackCalls: unknown[] = [];
    const engine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(options) {
        fs.writeFileSync(
          path.join(
            options.task.policySnapshot.workspaceRoots[0]!,
            "index.html",
          ),
          "<h1>Fallback candidate</h1>",
        );
        await options.onEvent({
          type: "tool_request",
          id: "failed-open",
          tool: "browser_open",
          meta: { url: "https://blocked.example" },
        });
        await options.onEvent({
          type: "tool_request",
          id: "unresolved-open",
          tool: "browser_open",
          meta: { url: "https://missing.example" },
        });
        await options.onEvent({
          type: "tool_result",
          id: "failed-open",
          ok: false,
          output: "MCP unavailable",
        });
        await options.onEvent({ type: "done", summary: "done" });
      },
    };
    const host = mockHost([]);
    runner = new TaskRunner(tasks, audit, engine, {
      hostBridge: {
        ...host,
        async browserExec(req) {
          fallbackCalls.push(req);
          return { ok: false, output: "fallback navigation failed" };
        },
        async browserDestroy(taskId) {
          destroyCalls.push(taskId);
        },
      },
    });
    const ws = path.join(dir, "ws-direct-failed-open");
    fs.mkdirSync(ws);
    const task = tasks.create({
      goal: "Try the remote site",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });

    await runner.start(task.id);

    expect(fallbackCalls).toHaveLength(1);
    expect(destroyCalls).toEqual([task.id]);
    const failed = tasks
      .listEvents(task.id)
      .find(
        (event) =>
          event.kind === "tool_result" && event.payload.id === "failed-open",
      );
    expect(failed?.payload).toMatchObject({
      tool: "browser_open",
      ok: false,
    });
    expect(failed?.payload.browserProvider).toBeUndefined();
  });

  it("opens an HTML deliverable in the thread browser with one keyed truthful receipt", async () => {
    const configureCalls: Array<{ taskId: string }> = [];
    const execCalls: Array<{
      taskId: string;
      tool: string;
      args: Record<string, unknown>;
    }> = [];
    const host = mockHost([]);
    runner = new TaskRunner(tasks, audit, new TestEngine(), {
      hostBridge: {
        ...host,
        async browserConfigure(req) {
          configureCalls.push(req);
        },
        async browserExec(req) {
          execCalls.push(req);
          return { ok: true, output: "loaded", url: String(req.args.url) };
        },
      },
    });
    const ws = path.join(dir, "ws-one-click");
    fs.mkdirSync(ws);
    const html = path.join(ws, "index.html");
    fs.writeFileSync(html, "<h1>Panda</h1>");
    const root = tasks.create({
      goal: "Build site",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    const child = tasks.create({
      goal: "Open site",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
      parentTaskId: root.id,
    });

    await expect(runner.openLocalHtml(child.id, html)).resolves.toMatchObject({
      ok: true,
    });

    expect(configureCalls).toEqual([
      { taskId: root.id, policy: expect.any(Object) },
    ]);
    expect(execCalls).toEqual([
      {
        taskId: root.id,
        tool: "browser_open",
        args: { path: html, url: html },
        source: "renderer_user",
      },
    ]);
    const events = tasks.listEvents(child.id);
    const request = events.find((event) => event.kind === "tool_request");
    const result = events.find((event) => event.kind === "tool_result");
    expect(request?.payload).toMatchObject({ tool: "browser_open" });
    expect(result?.payload).toMatchObject({
      id: request?.payload.id,
      tool: "browser_open",
      ok: true,
      browserProvider: "desk-browser",
    });
    expect(events.filter((event) => event.kind === "message")).toHaveLength(0);
  });

  it("opens a chat link in the thread browser and rejects unsafe schemes", async () => {
    const execCalls: Array<{
      taskId: string;
      args: Record<string, unknown>;
      source?: string;
    }> = [];
    const host = mockHost([]);
    runner = new TaskRunner(tasks, audit, new TestEngine(), {
      hostBridge: {
        ...host,
        async browserExec(request) {
          execCalls.push(request);
          return { ok: true, output: "loaded" };
        },
      },
    });
    const workspace = path.join(dir, "ws-chat-link");
    fs.mkdirSync(workspace);
    const root = tasks.create({ goal: "Research", workspaceRoots: [workspace] });
    const child = tasks.create({
      goal: "Read source",
      workspaceRoots: [workspace],
      parentTaskId: root.id,
    });

    await expect(
      runner.openUrlInAgentBrowser(child.id, "https://example.com/source"),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      runner.openUrlInAgentBrowser(child.id, "javascript:alert(1)"),
    ).resolves.toMatchObject({ ok: false });

    expect(execCalls).toEqual([
      {
        taskId: root.id,
        tool: "browser_open",
        args: { url: "https://example.com/source" },
        source: "renderer_user",
      },
    ]);
  });

  it("lets the host policy deny an outside path without recording browser success", async () => {
    const execCalls: Array<{ taskId: string; args: Record<string, unknown> }> = [];
    const host = mockHost([]);
    runner = new TaskRunner(tasks, audit, new TestEngine(), {
      hostBridge: {
        ...host,
        async browserExec(req) {
          execCalls.push(req);
          return {
            ok: false,
            output: "Local browser file is outside the authorized workspace roots",
          };
        },
      },
    });
    const ws = path.join(dir, "ws-policy-owner");
    fs.mkdirSync(ws);
    const outside = path.join(dir, "outside.html");
    fs.writeFileSync(outside, "outside");
    const task = tasks.create({
      goal: "Open site",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });

    await expect(runner.openLocalHtml(task.id, outside)).resolves.toEqual({
      ok: false,
      output: "Local browser file is outside the authorized workspace roots",
    });

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0]?.args).toEqual({ path: outside, url: outside });
    const events = tasks.listEvents(task.id);
    const request = events.find((event) => event.kind === "tool_request");
    const result = events.find((event) => event.kind === "tool_result");
    expect(result?.payload).toMatchObject({
      id: request?.payload.id,
      ok: false,
    });
    expect(result?.payload.browserProvider).toBeUndefined();
    expect(events.filter((event) => event.kind === "message")).toHaveLength(0);
  });

  it("preserves a no-network task policy for user-click and harvest HTML opens", async () => {
    const configured: Array<{
      taskId: string;
      policy: {
        approvalMode: string;
        workspaceRoots: string[];
        allowNetworkTools: boolean;
        allowShell: boolean;
      };
    }> = [];
    const execCalls: Array<{ source?: string }> = [];
    const host = mockHost([]);
    runner = new TaskRunner(tasks, audit, new TestEngine(), {
      hostBridge: {
        ...host,
        async browserConfigure(req) {
          configured.push(req);
        },
        async browserExec(req) {
          execCalls.push(req);
          return {
            ok: false,
            output: "Network tools disabled",
          };
        },
      },
    });
    const ws = path.join(dir, "ws-no-network-browser");
    fs.mkdirSync(ws);
    const html = path.join(ws, "index.html");
    fs.writeFileSync(html, "<h1>Offline</h1>");
    const task = tasks.create({
      goal: "Open the local site",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
      allowNetworkTools: false,
      allowShell: false,
    });

    await expect(runner.openLocalHtml(task.id, html)).resolves.toMatchObject({
      ok: false,
      output: "Network tools disabled",
    });
    await expect(runner.harvestWorkspaceDeliverables(task.id)).resolves.toBe(
      false,
    );

    expect(configured).toHaveLength(2);
    expect(configured.map((call) => call.policy)).toEqual([
      task.policySnapshot,
      task.policySnapshot,
    ]);
    expect(execCalls).toEqual([
      {
        taskId: task.id,
        tool: "browser_open",
        args: { path: html, url: html },
        source: "renderer_user",
      },
      {
        taskId: task.id,
        tool: "browser_open",
        args: { path: html, url: html },
        source: "agent",
      },
    ]);
  });

  it("does not start tasks while paused", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "Paused",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    tasks.pauseAll();
    await runner.start(t.id);
    expect(tasks.get(t.id)?.status).toBe("queued");
    expect(fs.existsSync(path.join(ws, "grokdesk-output.md"))).toBe(false);

    tasks.resumeAll();
    await runner.pumpQueue();
    expect(tasks.get(t.id)?.status).toBe("done");
  });

  it("respects maxConcurrent", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);

    class SlowEngine implements EngineAdapter {
      async cancel(): Promise<void> {}
      async run(options: EngineRunOptions): Promise<void> {
        await new Promise((r) => setTimeout(r, 80));
        await options.onEvent({ type: "done", summary: "ok" });
      }
    }

    runner = new TaskRunner(tasks, audit, new SlowEngine(), {
      maxConcurrent: 1,
    });

    const t1 = tasks.create({
      goal: "one",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    const t2 = tasks.create({
      goal: "two",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });

    // Kick both without awaiting full completion of pump
    const p1 = runner.start(t1.id);
    // Give t1 a moment to enter running
    await new Promise((r) => setTimeout(r, 5));
    expect(runner.runningCount).toBe(1);

    // Second start should no-op while at cap
    const p2 = runner.start(t2.id);
    expect(tasks.get(t2.id)?.status).toBe("queued");

    await p1;
    await p2;
    // After t1 finishes, pumpQueue in finally should pick up t2
    // Wait for t2 if needed
    if (tasks.get(t2.id)?.status === "queued") {
      await runner.start(t2.id);
    } else {
      // may already be running from finally pump — await via start
      await runner.start(t2.id);
    }
    // Ensure both complete
    for (let i = 0; i < 50; i++) {
      const s2 = tasks.get(t2.id)?.status;
      if (s2 === "done" || s2 === "failed") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(tasks.get(t1.id)?.status).toBe("done");
    expect(tasks.get(t2.id)?.status).toBe("done");
  });

  it("pumpQueue starts queued tasks and awaits completion", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    tasks.create({
      goal: "via pump",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    await runner.pumpQueue();
    const list = tasks.list();
    expect(list[0]?.status).toBe("done");
    expect(fs.existsSync(path.join(ws, "grokdesk-output.md"))).toBe(true);
  });

  it("does not start queued work whose durable conversation ledger is not ready", async () => {
    const ws = path.join(dir, "ws-not-ready");
    fs.mkdirSync(ws);
    const task = tasks.create({
      goal: "wait for its user turn",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    runner = new TaskRunner(tasks, audit, new TestEngine(), {
      isTaskReady: () => false,
    });

    await runner.pumpQueue();
    await runner.start(task.id);

    expect(tasks.get(task.id)?.status).toBe("queued");
    expect(fs.existsSync(path.join(ws, "grokdesk-output.md"))).toBe(false);
  });
});
