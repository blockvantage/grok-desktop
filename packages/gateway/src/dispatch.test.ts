import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeRoot } from "@grokdesk/shared";
import { TestEngine } from "@grokdesk/engine-testkit";
import { Gateway } from "./index.js";
import { dispatchGateway } from "./dispatch.js";

// Mock CLI auth probe so this suite never spawns `grok models` (H6 flake).
vi.mock("@grokdesk/engine-grok", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@grokdesk/engine-grok")>();
  return {
    ...actual,
    getGrokAuthStatus: vi.fn(async () => ({
      signedIn: false,
      accountLabel: null,
      accountName: null,
      needsReauth: true,
      engineStatus: "needs_auth" as const,
      binaryPath: null,
      models: [] as string[],
      defaultModel: null,
    })),
  };
});

describe("dispatchGateway", () => {
  let dir: string;
  let gateway: Gateway;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-gw-"));
    gateway = new Gateway(
      {
        dataDir: dir,
        logsDir: path.join(dir, "logs"),
        dbPath: path.join(dir, "db.sqlite"),
      },
      { engine: new TestEngine() },
    );
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates task through IPC shape", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const task = (await dispatchGateway(gateway, {
      id: "1",
      method: "tasks.create",
      params: {
        goal: "Hello",
        workspaceRoots: [ws],
        approvalMode: "autopilot",
      },
    })) as { id: string; goal: string };
    expect(task.goal).toBe("Hello");

    await gateway.runner.start(task.id);

    const list = (await dispatchGateway(gateway, {
      id: "2",
      method: "tasks.list",
      params: {},
    })) as { id: string; status: string }[];
    expect(list.length).toBe(1);
    expect(list[0]!.status).toBe("done");
  });

  it("autopilot create completes to done and writes file", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const task = (await dispatchGateway(gateway, {
      id: "1",
      method: "tasks.create",
      params: {
        goal: "Ship it",
        workspaceRoots: [ws],
        approvalMode: "autopilot",
      },
    })) as {
      id: string;
      policySnapshot: { workspaceRoots: string[] };
    };

    // User project is primary (deliverables + folder grouping); managed chat is secondary.
    // Roots are stored with normalizeRoot (forward slashes on Windows).
    expect(task.policySnapshot.workspaceRoots[0]).toBe(
      normalizeRoot(path.resolve(ws)),
    );
    expect(
      task.policySnapshot.workspaceRoots.some((r) =>
        /workspaces[/\\]grok-chat-/.test(r),
      ),
    ).toBe(true);

    await gateway.runner.start(task.id);

    const got = (await dispatchGateway(gateway, {
      id: "2",
      method: "tasks.get",
      params: { taskId: task.id },
    })) as { status: string };
    expect(got.status).toBe("done");

    const primary = task.policySnapshot.workspaceRoots[0]!;
    const out = path.join(primary, "grokdesk-output.md");
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.readFileSync(out, "utf8")).toContain("Ship it");

    const events = (await dispatchGateway(gateway, {
      id: "3",
      method: "events.list",
      params: { taskId: task.id, afterSeq: 0 },
    })) as { kind: string }[];
    expect(events.some((e) => e.kind === "tool_request")).toBe(true);
    expect(events.some((e) => e.kind === "artifact_created")).toBe(true);
  });

  it("follow-up reuses parent workspace roots (no new chat folder)", async () => {
    const task = (await dispatchGateway(gateway, {
      id: "1",
      method: "tasks.create",
      params: {
        goal: "First",
        workspaceRoots: [],
        approvalMode: "autopilot",
      },
    })) as {
      id: string;
      policySnapshot: { workspaceRoots: string[] };
    };
    const roots = task.policySnapshot.workspaceRoots;
    const follow = (await dispatchGateway(gateway, {
      id: "2",
      method: "tasks.create",
      params: {
        goal: "Second",
        workspaceRoots: [],
        parentTaskId: task.id,
        approvalMode: "autopilot",
      },
    })) as { policySnapshot: { workspaceRoots: string[] } };
    expect(follow.policySnapshot.workspaceRoots).toEqual(roots);
  });

  it("auth.status returns structured state", async () => {
    const auth = (await dispatchGateway(gateway, {
      id: "1",
      method: "auth.status",
      params: {},
    })) as { signedIn: boolean; engineStatus: string };
    expect(auth.signedIn).toBe(false);
    expect(auth.engineStatus).toBe("needs_auth");

    const tray = (await dispatchGateway(gateway, {
      id: "2",
      method: "tray.status",
      params: {},
    })) as { status: string; runningCount: number };
    expect(tray.status).toBe("idle");
    expect(tray.runningCount).toBe(0);
  });

  it("schedule/memory/inbox/settings work", async () => {
    expect(
      await dispatchGateway(gateway, {
        id: "1",
        method: "schedule.list",
        params: {},
      }),
    ).toEqual([]);
    expect(
      await dispatchGateway(gateway, {
        id: "2",
        method: "memory.list",
        params: {},
      }),
    ).toEqual([]);
    expect(
      await dispatchGateway(gateway, {
        id: "3",
        method: "inbox.list",
        params: {},
      }),
    ).toEqual([]);
    const settings = (await dispatchGateway(gateway, {
      id: "4",
      method: "settings.get",
      params: {},
    })) as { maxConcurrentTasks: number };
    expect(settings.maxConcurrentTasks).toBe(3);
    const next = (await dispatchGateway(gateway, {
      id: "5",
      method: "settings.set",
      params: { maxConcurrentTasks: 4 },
    })) as { maxConcurrentTasks: number };
    expect(next.maxConcurrentTasks).toBe(4);
  });

  it("tray.status includes GoalUpdated progressLine for a live task", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const task = (await dispatchGateway(gateway, {
      id: "1",
      method: "tasks.create",
      params: {
        goal: "Hello",
        workspaceRoots: [ws],
        approvalMode: "autopilot",
      },
    })) as { id: string };
    gateway.tasks.setStatus(task.id, "running");
    gateway.tasks.appendEvent(task.id, "step", {
      title: "goal_update",
      objective: "Ship the brief",
      progress: "Drafting",
    });
    const tray = (await dispatchGateway(gateway, {
      id: "2",
      method: "tray.status",
      params: {},
    })) as { progressLine?: string | null; status: string };
    expect(tray.status).toBe("working");
    expect(tray.progressLine).toBe("Ship the brief — Drafting");
  });

  it("pauseAll / resumeAll via IPC", async () => {
    await dispatchGateway(gateway, {
      id: "1",
      method: "tasks.pauseAll",
      params: {},
    });
    const tray = (await dispatchGateway(gateway, {
      id: "2",
      method: "tray.status",
      params: {},
    })) as { status: string };
    expect(tray.status).toBe("paused");

    await dispatchGateway(gateway, {
      id: "3",
      method: "tasks.resumeAll",
      params: {},
    });
    const tray2 = (await dispatchGateway(gateway, {
      id: "4",
      method: "tray.status",
      params: {},
    })) as { status: string };
    expect(tray2.status).toBe("idle");
  });

  it("routes renderer browser RPCs through schema validation to tasks-core", async () => {
    const openLocalHtml = vi
      .spyOn(gateway.runner, "openLocalHtml")
      .mockResolvedValue({ ok: true, output: "opened" });

    await expect(
      dispatchGateway(gateway, {
        id: "browser-open",
        method: "browser.openHtml",
        params: { taskId: "task-1", path: "/workspace/index.html" },
      }),
    ).resolves.toEqual({ ok: true, output: "opened" });
    expect(openLocalHtml).toHaveBeenCalledWith(
      "task-1",
      "/workspace/index.html",
    );

    await expect(
      dispatchGateway(gateway, {
        id: "browser-capability",
        method: "browser.capability",
        params: {},
      }),
    ).resolves.toMatchObject({ provider: expect.any(String) });
  });

  it("rolePacks.list returns packs", async () => {
    const packs = (await dispatchGateway(gateway, {
      id: "1",
      method: "rolePacks.list",
      params: {},
    })) as { id: string }[];
    expect(packs.some((p) => p.id === "marketing")).toBe(true);
  });

  it("creates temp workspace when no folder given (chat mode)", async () => {
    const task = (await dispatchGateway(gateway, {
      id: "1",
      method: "tasks.create",
      params: {
        goal: "Hello chat",
        workspaceRoots: [],
        approvalMode: "autopilot",
      },
    })) as {
      id: string;
      policySnapshot: { workspaceRoots: string[] };
    };
    expect(task.policySnapshot.workspaceRoots.length).toBe(1);
    const root = task.policySnapshot.workspaceRoots[0]!;
    // Managed under dataDir/workspaces/grok-chat-* (not OS temp, not user project)
    expect(root).toMatch(/workspaces[/\\]grok-chat-/i);
    expect(fs.existsSync(root)).toBe(true);

    await gateway.runner.start(task.id);
    const got = (await dispatchGateway(gateway, {
      id: "2",
      method: "tasks.get",
      params: { taskId: task.id },
    })) as { status: string };
    expect(got.status).toBe("done");
  });
});
