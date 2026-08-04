/**
 * Entrypoint matrix — every Grok-backed admission path blocks on expired lease;
 * local read/manage/recovery remain allowed (Task 8).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DeviceLeaseClaims } from "@grokdesk/license";
import { TestEngine } from "@grokdesk/engine-testkit";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { AuditService } from "./audit.js";
import { RunAttemptService } from "./run-attempts.js";
import { SettingsService } from "./settings.js";
import { TaskSubmissionService } from "./task-submission.js";
import { SchedulerService } from "./scheduler.js";
import { TaskRunner } from "./runner.js";
import {
  createEntitlementGuard,
  isEntitlementReadOnlyError,
  type EntitlementGuard,
} from "./entitlement-guard.js";
import { EntitlementReadOnlyError } from "./entitlement-error.js";
import { EntitlementGuardedEngine } from "./entitlement-engine.js";
import { autoTitleTask } from "./title-generation.js";
import {
  remoteRequestContext,
  desktopRequestContext,
} from "./request-context.js";
import type { Task } from "@grokdesk/shared";

const FIXED_NOW = 1_700_000_000;

const protectedEntrypoints = [
  "interactive",
  "follow_up",
  "revision",
  "retry",
  "remote",
  "scheduled",
  "queued_execution",
  "provider_inference",
  "title_generation",
  "dictation",
] as const;

const alwaysAllowed = [
  { capability: "local_read" as const, action: "view_conversation" },
  { capability: "local_read" as const, action: "view_artifact" },
  { capability: "local_read" as const, action: "view_task" },
  { capability: "local_read" as const, action: "export_chat" },
  { capability: "local_manage" as const, action: "edit_settings" },
  { capability: "local_read" as const, action: "diagnostics_logs" },
  { capability: "recovery" as const, action: "runtime_repair" },
  { capability: "recovery" as const, action: "runtime_update" },
  { capability: "recovery" as const, action: "entitlement_portal" },
  { capability: "local_manage" as const, action: "local_manage" },
  { capability: "local_manage" as const, action: "cancellation" },
  { capability: "local_manage" as const, action: "deletion" },
];

function activeClaims(
  overrides: Partial<DeviceLeaseClaims> = {},
): DeviceLeaseClaims {
  return {
    iss: "https://entitlements.test",
    aud: "grok-desk-device",
    entitlementId: "ent-1",
    activationId: "act-1",
    deviceThumbprint: "tp-1",
    productId: "grok-desk",
    capabilities: ["grok-runtime"],
    seatLimit: 3,
    updatePolicy: "lifetime_stable",
    iat: FIXED_NOW,
    refreshAfter: FIXED_NOW + 86_400,
    exp: FIXED_NOW + 30 * 86_400,
    jti: "jti-1",
    ...overrides,
  };
}

function expiredClaims(): DeviceLeaseClaims {
  return activeClaims({
    exp: FIXED_NOW - 60,
    refreshAfter: FIXED_NOW - 3600,
  });
}

function makeGuard(claims: DeviceLeaseClaims | null): EntitlementGuard {
  return createEntitlementGuard({
    keyRing: {
      kty: "OKP",
      crv: "Ed25519",
      x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    expectedIssuer: "https://entitlements.test",
    expectedAudience: "grok-desk-device",
    nowSeconds: () => FIXED_NOW,
    clockToleranceSeconds: 0,
    injectVerifiedClaims: claims,
    loadState: () => ({
      schema: 1,
      deviceId: "d1",
      devicePublicKeyThumbprint: "tp-1",
      lease: claims ? "unused" : null,
      authoritativeState: "none",
      updatedAt: new Date(FIXED_NOW * 1000).toISOString(),
      requestId: null,
    }),
  });
}

function fakeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    goal: "hi",
    title: null,
    mode: "interactive",
    status: "running",
    model: "grok-4.5",
    effort: "normal",
    policySnapshot: {
      approvalMode: "autopilot",
      workspaceRoots: ["/tmp"],
      allowNetworkTools: false,
      allowShell: false,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

describe("Grok entitlement entrypoint matrix", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;
  let runs: RunAttemptService;
  let settings: SettingsService;
  let expiredGuard: EntitlementGuard;
  let activeGuard: EntitlementGuard;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ent-entry-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
    runs = new RunAttemptService(db);
    settings = new SettingsService(db);
    settings.set({ quietHours: null });
    expiredGuard = makeGuard(expiredClaims());
    activeGuard = makeGuard(activeClaims());
    await expiredGuard.refresh();
    await activeGuard.refresh();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function assertBlocked(
    entrypoint: (typeof protectedEntrypoints)[number],
  ): Promise<void> {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws, { recursive: true });

    switch (entrypoint) {
      case "interactive": {
        const submit = new TaskSubmissionService(tasks, runs, expiredGuard);
        expect(() =>
          submit.submit(
            { goal: "hello", workspaceRoots: [ws], mode: "interactive" },
            desktopRequestContext("req-interactive"),
          ),
        ).toThrow(EntitlementReadOnlyError);
        break;
      }
      case "follow_up": {
        const parent = tasks.create({
          goal: "parent",
          workspaceRoots: [ws],
        });
        const submit = new TaskSubmissionService(tasks, runs, expiredGuard);
        expect(() =>
          submit.submit(
            {
              goal: "follow",
              workspaceRoots: [ws],
              parentTaskId: parent.id,
            },
            desktopRequestContext("req-follow"),
          ),
        ).toThrow(EntitlementReadOnlyError);
        break;
      }
      case "revision": {
        const source = tasks.create({
          goal: "source",
          workspaceRoots: [ws],
        });
        const submit = new TaskSubmissionService(tasks, runs, expiredGuard);
        expect(() =>
          submit.submit(
            {
              goal: "revised",
              workspaceRoots: [ws],
              revisionOfTaskId: source.id,
            },
            desktopRequestContext("req-rev"),
          ),
        ).toThrow(EntitlementReadOnlyError);
        break;
      }
      case "retry": {
        const submit = new TaskSubmissionService(tasks, runs, expiredGuard);
        expect(() =>
          submit.submit(
            { goal: "retry me", workspaceRoots: [ws] },
            desktopRequestContext("req-retry"),
            { action: "retry" },
          ),
        ).toThrow(EntitlementReadOnlyError);
        break;
      }
      case "remote": {
        const submit = new TaskSubmissionService(tasks, runs, expiredGuard);
        expect(() =>
          submit.submit(
            { goal: "remote goal", workspaceRoots: [ws] },
            remoteRequestContext({
              principalDeviceId: "dev-1",
              machineId: "m-1",
              requestId: "req-remote",
            }),
          ),
        ).toThrow(EntitlementReadOnlyError);
        break;
      }
      case "scheduled": {
        const scheduler = new SchedulerService(db, tasks, settings, ws);
        const submit = new TaskSubmissionService(tasks, runs, expiredGuard);
        scheduler.setTaskSubmission(submit);
        scheduler.setEntitlementGuard(expiredGuard);
        scheduler.create({
          name: "due",
          goalTemplate: "scheduled work",
          cron: "* * * * *",
          timezone: "UTC",
          workspaceRoots: [ws],
          quietHoursRespect: false,
          approvalMode: "autopilot",
        });
        scheduler.resetFireState();
        const created = scheduler.tick(new Date());
        expect(created).toEqual([]);
        expect(tasks.list().filter((t) => t.mode === "scheduled")).toHaveLength(
          0,
        );
        break;
      }
      case "queued_execution": {
        // Create task without guard so it sits queued, then runner blocks.
        const t = tasks.create({
          goal: "queued",
          workspaceRoots: [ws],
          approvalMode: "autopilot",
        });
        const runner = new TaskRunner(
          tasks,
          new AuditService(db),
          new TestEngine(),
          { runAttempts: runs, entitlementGuard: expiredGuard },
        );
        await runner.start(t.id);
        expect(tasks.get(t.id)?.status).toBe("blocked");
        // Must not spin: still blocked after another pump.
        await runner.pumpQueue();
        expect(tasks.get(t.id)?.status).toBe("blocked");
        break;
      }
      case "provider_inference": {
        const run = vi.fn(async () => {});
        const engine = new EntitlementGuardedEngine(
          { executesOwnTools: true, run, cancel: async () => {} },
          { guard: expiredGuard },
        );
        await expect(
          engine.run({ task: fakeTask(), onEvent: async () => {} }),
        ).rejects.toMatchObject({
          code: "entitlement_read_only",
          action: "provider_inference",
        });
        expect(run).not.toHaveBeenCalled();
        break;
      }
      case "title_generation": {
        const generate = vi.fn(async () => "Should not run");
        await autoTitleTask(
          {
            get: () => ({ title: null }),
            setTitle: () => {
              throw new Error("should not set title when blocked");
            },
          },
          "t-title",
          "goal text",
          "grok-4.5",
          generate,
          expiredGuard,
        );
        // Non-essential: silently skips; must not call model.
        expect(generate).not.toHaveBeenCalled();
        break;
      }
      case "dictation": {
        // Desktop dictation uses the same capability/action pair.
        await expect(
          expiredGuard.assertCapability("grok_operation", "dictation"),
        ).rejects.toMatchObject({
          code: "entitlement_read_only",
          action: "dictation",
        });
        break;
      }
      default: {
        const _exhaustive: never = entrypoint;
        throw new Error(`unhandled entrypoint: ${_exhaustive}`);
      }
    }
  }

  for (const entrypoint of protectedEntrypoints) {
    it(`blocks ${entrypoint} when the lease is expired`, async () => {
      await assertBlocked(entrypoint);
    });
  }

  for (const { capability, action } of alwaysAllowed) {
    it(`allows ${capability}/${action} when the lease is expired`, async () => {
      await expect(
        expiredGuard.assertCapability(capability, action),
      ).resolves.toBeUndefined();
    });
  }

  it("allows interactive submit when lease is active", () => {
    const ws = path.join(dir, "ws-ok");
    fs.mkdirSync(ws);
    const submit = new TaskSubmissionService(tasks, runs, activeGuard);
    const result = submit.submit(
      { goal: "ok", workspaceRoots: [ws], mode: "interactive" },
      desktopRequestContext("ok"),
    );
    expect(result.task.id).toBeTruthy();
    expect(result.runAttempt.id).toBeTruthy();
  });

  it("queued_execution runs to done when lease is active", async () => {
    const ws = path.join(dir, "ws-run");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "run me",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    const runner = new TaskRunner(
      tasks,
      new AuditService(db),
      new TestEngine(),
      { runAttempts: runs, entitlementGuard: activeGuard },
    );
    await runner.start(t.id);
    expect(tasks.get(t.id)?.status).toBe("done");
  });

  it("error surface never includes lease or claims", async () => {
    try {
      await expiredGuard.assertCapability("grok_operation", "interactive");
      expect.fail("expected throw");
    } catch (err) {
      expect(isEntitlementReadOnlyError(err)).toBe(true);
      const bag = JSON.stringify(err);
      expect(bag).not.toMatch(/eyJ/);
      expect(bag).not.toContain("entitlementId");
      expect(bag).not.toContain("claims");
    }
  });
});
