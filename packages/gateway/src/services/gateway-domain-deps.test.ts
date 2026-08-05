import { describe, it, expect, vi } from "vitest";
import { buildDomainDispatchDeps } from "./gateway-domain-deps.js";
import { dispatchDomainMethod } from "./domain-dispatch.js";

describe("buildDomainDispatchDeps", () => {
  it("wires tasks.list through domain dispatch", async () => {
    const list = vi.fn(() => [{ id: "t1" }]);
    const event = {
      id: "event-4",
      taskId: "t1",
      seq: 4,
      kind: "message",
      payload: { role: "assistant", text: "hello" },
      createdAt: "2026-07-15T12:00:00.000Z",
    };
    const bag = {
      paths: { dataDir: "/data" },
      tasks: {
        list,
        get: vi.fn(),
        setTitle: vi.fn(),
        pauseAll: vi.fn(),
        resumeAll: vi.fn(),
        listEvents: vi.fn(() => [event]),
      },
      runner: {
        cancel: vi.fn(),
        approve: vi.fn(),
        registerHostBrowserApproval: vi.fn(),
        pumpQueue: vi.fn(async () => {}),
        harvestWorkspaceDeliverables: vi.fn(() => 0),
      },
      audit: { append: vi.fn(), list: vi.fn(() => []) },
      settings: {
        getAll: vi.fn(() => ({})),
        getBundledSkillsInfo: vi.fn(() => ({
          found: false,
          root: null,
          packs: [],
        })),
        getEffectiveSkillsPaths: vi.fn(() => []),
        set: vi.fn(),
        listConnectorPresets: vi.fn(() => []),
      },
      scheduler: {
        list: vi.fn(() => []),
        create: vi.fn(),
        setEnabled: vi.fn(),
      },
      memory: {
        list: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
      },
      inbox: {
        list: vi.fn(() => []),
        markRead: vi.fn(),
        dismiss: vi.fn(),
      },
      artifacts: { list: vi.fn(() => []) },
      deleteChat: vi.fn(),
      authStatus: vi.fn(async () => ({ signedIn: false })),
      authSignIn: vi.fn(),
      authSignOut: vi.fn(),
      computeTrayStatus: vi.fn(() => ({ status: "idle", runningCount: 0 })),
      getGrokAuthStatus: vi.fn(async () => ({})),
      ensureTempWorkspace: vi.fn(),
      listWorkspaceFiles: vi.fn(),
      readWorkspaceFile: vi.fn(),
      readWorkspaceAsset: vi.fn(),
      prepareWorkspaceAsset: vi.fn(),
      applyEngineSettings: vi.fn(async () => false),
      connectorOpsDeps: vi.fn(() => ({
        getAll: () => ({}),
        enablePreset: vi.fn(),
        disablePreset: vi.fn(),
        enableRecommended: vi.fn(),
        getEffectiveSkillsPaths: () => [],
        applyEngineSettings: vi.fn(async () => false),
        doctorMcpServers: vi.fn(),
      })),
      desktopTaskOpsDeps: vi.fn(() => ({
        getGrant: vi.fn(),
        setGrant: vi.fn(),
        resume: vi.fn(),
      })),
    };

    const deps = buildDomainDispatchDeps(bag as never);
    const r = await dispatchDomainMethod("tasks.list", {}, deps);
    expect(r).toEqual({ handled: true, result: [{ id: "t1" }] });
    expect(list).toHaveBeenCalled();

    const events = await dispatchDomainMethod(
      "events.list",
      { taskId: "t1", afterSeq: 3 },
      deps,
    );
    expect(events).toEqual({ handled: true, result: [event] });
    expect(bag.tasks.listEvents).toHaveBeenCalledWith("t1", 3);
  });

  it("wires audit.list filters into g.audit.list (not dropped)", async () => {
    const auditList = vi.fn(() => ({
      entries: [
        {
          id: "e1",
          taskId: "task-1",
          action: "tool.deny",
          detail: {},
          decision: "deny",
          createdAt: "2026-08-01T10:00:00.000Z",
        },
      ],
      hasMore: false,
      total: 1,
      limit: 20,
    }));
    const bag = {
      paths: { dataDir: "/data" },
      tasks: {
        list: vi.fn(() => []),
        get: vi.fn(),
        setTitle: vi.fn(),
        pauseAll: vi.fn(),
        resumeAll: vi.fn(),
        listEvents: vi.fn(() => []),
      },
      runner: {
        cancel: vi.fn(),
        approve: vi.fn(),
        registerHostBrowserApproval: vi.fn(),
        pumpQueue: vi.fn(async () => {}),
        harvestWorkspaceDeliverables: vi.fn(() => 0),
      },
      audit: { append: vi.fn(), list: auditList },
      settings: {
        getAll: vi.fn(() => ({})),
        getBundledSkillsInfo: vi.fn(() => ({
          found: false,
          root: null,
          packs: [],
        })),
        getEffectiveSkillsPaths: vi.fn(() => []),
        set: vi.fn(),
        listConnectorPresets: vi.fn(() => []),
      },
      scheduler: {
        list: vi.fn(() => []),
        create: vi.fn(),
        setEnabled: vi.fn(),
      },
      memory: {
        list: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
      },
      inbox: {
        list: vi.fn(() => []),
        markRead: vi.fn(),
        dismiss: vi.fn(),
      },
      artifacts: { list: vi.fn(() => []) },
      deleteChat: vi.fn(),
      authStatus: vi.fn(async () => ({ signedIn: false })),
      authSignIn: vi.fn(),
      authSignOut: vi.fn(),
      computeTrayStatus: vi.fn(() => ({ status: "idle", runningCount: 0 })),
      getGrokAuthStatus: vi.fn(async () => ({})),
      ensureTempWorkspace: vi.fn(),
      listWorkspaceFiles: vi.fn(),
      readWorkspaceFile: vi.fn(),
      readWorkspaceAsset: vi.fn(),
      prepareWorkspaceAsset: vi.fn(),
      applyEngineSettings: vi.fn(async () => false),
      connectorOpsDeps: vi.fn(() => ({
        getAll: () => ({}),
        enablePreset: vi.fn(),
        disablePreset: vi.fn(),
        enableRecommended: vi.fn(),
        getEffectiveSkillsPaths: () => [],
        applyEngineSettings: vi.fn(async () => false),
        doctorMcpServers: vi.fn(),
      })),
      desktopTaskOpsDeps: vi.fn(() => ({
        getGrant: vi.fn(),
        setGrant: vi.fn(),
        resume: vi.fn(),
      })),
    };

    const deps = buildDomainDispatchDeps(bag as never);
    const out = await dispatchDomainMethod(
      "audit.list",
      { taskId: "task-1", decision: "deny", limit: 20 },
      deps,
    );
    expect(out.handled).toBe(true);
    expect(auditList).toHaveBeenCalledWith({
      taskId: "task-1",
      decision: "deny",
      limit: 20,
    });
    // Guards against wiring that drops params: auditList: () => g.audit.list({})
    expect(auditList).not.toHaveBeenCalledWith({});
    expect(out.result).toEqual({
      entries: [
        {
          id: "e1",
          taskId: "task-1",
          action: "tool.deny",
          detail: {},
          decision: "deny",
          createdAt: "2026-08-01T10:00:00.000Z",
        },
      ],
      hasMore: false,
      total: 1,
      limit: 20,
    });
  });
});
