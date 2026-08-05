import { describe, it, expect, vi } from "vitest";
import { dispatchDomainMethod } from "./domain-dispatch.js";

function emptyDeps() {
  return {
    tasksCore: {
      list: vi.fn(() => []),
      get: vi.fn(),
      cancel: vi.fn(),
      setTitle: vi.fn(),
      deleteChat: vi.fn(),
      approve: vi.fn(),
      registerBrowserHostApproval: vi.fn(),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      pumpQueue: vi.fn(),
    },
    auth: {
      authStatus: vi.fn(async () => ({ signedIn: false })),
      authSignIn: vi.fn(),
      authSignOut: vi.fn(),
      isMainProcessAuthMethod: () => true,
      mainProcessAuthErrorMessage: (m: string) => m,
    },
    desktopTask: {
      getGrant: vi.fn(),
      setGrant: vi.fn(),
      resume: vi.fn(),
    },
    settings: {
      getAll: vi.fn(() => ({})),
      getBundledSkillsInfo: vi.fn(() => ({
        found: false,
        root: null,
        packs: [],
      })),
      getEffectiveSkillsPaths: vi.fn(() => []),
      set: vi.fn(),
      applyEngineSettings: vi.fn(),
    },
    licenseMeta: {
      computeTrayStatus: vi.fn(() => ({ status: "idle", runningCount: 0 })),
      getGrokAuthStatus: vi.fn(),
    },
    connectors: {
      listPresets: vi.fn(() => []),
      enable: vi.fn(),
      disable: vi.fn(),
      enableRecommended: vi.fn(),
      doctor: vi.fn(),
    },
    workspace: {
      ensureTemp: vi.fn(),
      listFiles: vi.fn(),
      readFile: vi.fn(),
      readAsset: vi.fn(),
      prepareAsset: vi.fn(),
    },
    sideData: {
      scheduleList: vi.fn(() => []),
      scheduleCreate: vi.fn(),
      scheduleSetEnabled: vi.fn(),
      scheduleDelete: vi.fn(),
      memoryList: vi.fn(),
      memoryUpsert: vi.fn(),
      memoryDelete: vi.fn(),
      inboxList: vi.fn(() => []),
      inboxMarkRead: vi.fn(),
      inboxDismiss: vi.fn(),
      auditList: vi.fn(() => []),
    },
    eventsExport: {
      listEvents: vi.fn(() => []),
      getTask: vi.fn(),
      listTasks: vi.fn(() => []),
      dataDir: "/data",
    },
    artifactsList: {
      getTaskStatus: vi.fn(),
      harvest: vi.fn(),
      list: vi.fn(() => []),
    },
  };
}

describe("dispatchDomainMethod", () => {
  it("handles tasks.list via tasks-core", async () => {
    const deps = emptyDeps();
    const r = await dispatchDomainMethod("tasks.list", {}, deps);
    expect(r).toEqual({ handled: true, result: [] });
    expect(deps.tasksCore.list).toHaveBeenCalled();
  });

  it("handles artifacts.list", async () => {
    const deps = emptyDeps();
    const r = await dispatchDomainMethod("artifacts.list", {}, deps);
    expect(r.handled).toBe(true);
    expect(deps.artifactsList.list).toHaveBeenCalled();
  });

  it("returns handled false for unknown", async () => {
    const deps = emptyDeps();
    const r = await dispatchDomainMethod("nope.method", {}, deps);
    expect(r).toEqual({ handled: false });
  });
});
