import { describe, it, expect, vi } from "vitest";
import {
  dispatchTasksCoreMethod,
  isTasksCoreMethod,
} from "./tasks-core-dispatch.js";

describe("isTasksCoreMethod", () => {
  it("matches core task methods", () => {
    expect(isTasksCoreMethod("tasks.list")).toBe(true);
    expect(isTasksCoreMethod("tasks.approve")).toBe(true);
    expect(isTasksCoreMethod("browser.hostApproval")).toBe(true);
    expect(isTasksCoreMethod("browser.capability")).toBe(true);
    expect(isTasksCoreMethod("browser.allowExternal")).toBe(true);
    expect(isTasksCoreMethod("tasks.create")).toBe(false);
  });
});

describe("dispatchTasksCoreMethod", () => {
  it("list/get/cancel", async () => {
    const deps = {
      list: vi.fn(() => [{ id: "t1" }]),
      get: vi.fn((id: string) => ({ id, status: "cancelled" })),
      cancel: vi.fn(async () => {}),
      setTitle: vi.fn(),
      deleteChat: vi.fn(),
      approve: vi.fn(),
      registerBrowserHostApproval: vi.fn(),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      pumpQueue: vi.fn(),
    };
    expect(await dispatchTasksCoreMethod("tasks.list", {}, deps)).toEqual([
      { id: "t1" },
    ]);
    expect(
      await dispatchTasksCoreMethod("tasks.get", { taskId: "t1" }, deps),
    ).toEqual({ id: "t1", status: "cancelled" });
    expect(
      await dispatchTasksCoreMethod("tasks.cancel", { taskId: "t1" }, deps),
    ).toEqual({ id: "t1", status: "cancelled", ok: true });
    expect(deps.cancel).toHaveBeenCalledWith("t1");
  });

  it("setTitle resetToAuto writes an empty stored title", async () => {
    const setTitle = vi.fn();
    const deps = {
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      setTitle,
      deleteChat: vi.fn(),
      approve: vi.fn(),
      registerBrowserHostApproval: vi.fn(),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      pumpQueue: vi.fn(),
    };
    await dispatchTasksCoreMethod(
      "tasks.setTitle",
      { taskId: "t1", resetToAuto: true },
      deps,
    );
    expect(setTitle).toHaveBeenCalledWith("t1", "");
  });

  it("cancel uses cancel-outcome for missing and non-gateway ids", async () => {
    const deps = {
      list: vi.fn(() => []),
      get: vi.fn(() => null),
      cancel: vi.fn(async () => {}),
      setTitle: vi.fn(),
      deleteChat: vi.fn(),
      approve: vi.fn(),
      registerBrowserHostApproval: vi.fn(),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      pumpQueue: vi.fn(),
    };
    await expect(
      dispatchTasksCoreMethod("tasks.cancel", { taskId: "missing" }, deps),
    ).rejects.toThrow(/not found/i);
    expect(deps.cancel).not.toHaveBeenCalled();

    const opt = (await dispatchTasksCoreMethod(
      "tasks.cancel",
      { taskId: "optimistic-xyz" },
      deps,
    )) as { ok: boolean };
    expect(opt.ok).toBe(false);
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it("approve and pause/resume", async () => {
    const deps = {
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      setTitle: vi.fn(),
      deleteChat: vi.fn(),
      approve: vi.fn(async () => {}),
      registerBrowserHostApproval: vi.fn(() => ({ ok: true })),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      pumpQueue: vi.fn(),
    };
    expect(
      await dispatchTasksCoreMethod(
        "tasks.approve",
        { approvalId: "a1", decision: "reject" },
        deps,
      ),
    ).toEqual({ ok: true });
    expect(deps.approve).toHaveBeenCalledWith("a1", "reject", {
      remember: false,
    });
    expect(
      await dispatchTasksCoreMethod("tasks.resumeAll", {}, deps),
    ).toEqual({ ok: true });
    expect(deps.resumeAll).toHaveBeenCalled();
    expect(deps.pumpQueue).toHaveBeenCalled();
  });

  it("browser.openHtml delegates to openLocalHtml", async () => {
    const openLocalHtml = vi.fn(async () => ({
      ok: true,
      output: "opened /tmp/x.html",
    }));
    const deps = {
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      setTitle: vi.fn(),
      deleteChat: vi.fn(),
      approve: vi.fn(),
      registerBrowserHostApproval: vi.fn(),
      openLocalHtml,
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      pumpQueue: vi.fn(),
    };
    const r = await dispatchTasksCoreMethod(
      "browser.openHtml",
      { taskId: "t1", path: "/tmp/x.html" },
      deps,
    );
    expect(openLocalHtml).toHaveBeenCalledWith({
      taskId: "t1",
      path: "/tmp/x.html",
    });
    expect(r).toMatchObject({ ok: true });
  });

  it("registers browser.openHtml as a core method", () => {
    expect(isTasksCoreMethod("browser.openHtml")).toBe(true);
  });

  it("browser.openUrl delegates to the task-partitioned agent browser", async () => {
    const openUrl = vi.fn(async () => ({ ok: true, output: "opened" }));
    const deps = {
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      setTitle: vi.fn(),
      deleteChat: vi.fn(),
      approve: vi.fn(),
      registerBrowserHostApproval: vi.fn(),
      openUrl,
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      pumpQueue: vi.fn(),
    };

    const result = await dispatchTasksCoreMethod(
      "browser.openUrl",
      { taskId: "task-1", url: "https://example.com/docs" },
      deps,
    );

    expect(isTasksCoreMethod("browser.openUrl")).toBe(true);
    expect(openUrl).toHaveBeenCalledWith({
      taskId: "task-1",
      url: "https://example.com/docs",
    });
    expect(result).toEqual({ ok: true, output: "opened" });
  });

  it("browser.capability returns verified handshake from deps", async () => {
    const deps = {
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      setTitle: vi.fn(),
      deleteChat: vi.fn(),
      approve: vi.fn(),
      registerBrowserHostApproval: vi.fn(),
      browserCapability: vi.fn(() => ({
        ok: true,
        status: "ready",
        provider: "desk-browser",
        tools: ["browser.open"],
      })),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      pumpQueue: vi.fn(),
    };
    const r = (await dispatchTasksCoreMethod(
      "browser.capability",
      {},
      deps,
    )) as { ok: boolean; provider: string };
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("desk-browser");
    expect(deps.browserCapability).toHaveBeenCalled();
  });

  it("rejects oversized task.interject text", async () => {
    const deps = {
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      setTitle: vi.fn(),
      deleteChat: vi.fn(),
      approve: vi.fn(),
      registerBrowserHostApproval: vi.fn(),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      pumpQueue: vi.fn(),
      interject: vi.fn(async () => true),
    };
    await expect(
      dispatchTasksCoreMethod(
        "task.interject",
        { taskId: "t1", text: "x".repeat(32_001) },
        deps,
      ),
    ).rejects.toThrow(/too long/i);
    expect(deps.interject).not.toHaveBeenCalled();
  });

  it("forwards clientMutationId on task.interject and echoes it when delivered", async () => {
    const interject = vi.fn(async () => true);
    const deps = {
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      setTitle: vi.fn(),
      deleteChat: vi.fn(),
      approve: vi.fn(),
      registerBrowserHostApproval: vi.fn(),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      pumpQueue: vi.fn(),
      interject,
    };
    const result = (await dispatchTasksCoreMethod(
      "task.interject",
      {
        taskId: "t1",
        text: "mid-run aside",
        clientMutationId: "q-interject-1",
      },
      deps,
    )) as { delivered: boolean; clientMutationId?: string };
    expect(result.delivered).toBe(true);
    expect(result.clientMutationId).toBe("q-interject-1");
    expect(interject).toHaveBeenCalledWith(
      "t1",
      "mid-run aside",
      "q-interject-1",
    );
  });

  it("parseIpcRequest → dispatch keeps clientMutationId on the real IPC path", async () => {
    // Skeptic gap: Zod used to strip clientMutationId before gateway saw it.
    // Drive the real shared parse + core dispatch (not a hand-built params bag).
    const { parseIpcRequest } = await import("@grokdesk/shared");
    const { extractClientMutationId } = await import("./mutation-receipts.js");
    const interject = vi.fn(async () => true);
    const deps = {
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      setTitle: vi.fn(),
      deleteChat: vi.fn(),
      approve: vi.fn(),
      registerBrowserHostApproval: vi.fn(),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      pumpQueue: vi.fn(),
      interject,
    };
    const raw = {
      id: "ipc-1",
      method: "task.interject" as const,
      params: {
        taskId: "task-live",
        text: "reload-safe aside",
        clientMutationId: "q-interject-e2e",
        // Extra noise that Zod must drop — mutation id must still survive.
        unknownClientField: "drop-me",
      },
    };
    const parsed = parseIpcRequest(raw);
    expect(parsed.method).toBe("task.interject");
    const mutationId = extractClientMutationId(parsed);
    expect(mutationId).toBe("q-interject-e2e");
    // Idempotent set membership matches what Gateway.handle gates on.
    const { IDEMPOTENT_MUTATION_METHODS } = await import(
      "./mutation-receipts.js"
    );
    expect(IDEMPOTENT_MUTATION_METHODS.has(parsed.method)).toBe(true);

    const result = (await dispatchTasksCoreMethod(
      parsed.method,
      parsed.params as Record<string, unknown>,
      deps,
    )) as { delivered: boolean; clientMutationId?: string };
    expect(result.delivered).toBe(true);
    expect(result.clientMutationId).toBe("q-interject-e2e");
    expect(interject).toHaveBeenCalledWith(
      "task-live",
      "reload-safe aside",
      "q-interject-e2e",
    );
  });

  it("returns delivered=false without claiming ack when interject is unsupported", async () => {
    const deps = {
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      setTitle: vi.fn(),
      deleteChat: vi.fn(),
      approve: vi.fn(),
      registerBrowserHostApproval: vi.fn(),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      pumpQueue: vi.fn(),
      // no interject handler
    };
    const result = (await dispatchTasksCoreMethod(
      "task.interject",
      { taskId: "t1", text: "hi", clientMutationId: "m-x" },
      deps,
    )) as { delivered: boolean };
    expect(result.delivered).toBe(false);
  });
});
