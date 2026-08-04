import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACTIVE_TRAY_STATUSES,
  MANAGED_GROK_BINARY_ENV,
  applyManagedGrokBinaryEnv,
  createGatewayUpdateHealth,
  createRebuildGatewayHandler,
  createUpdateBootstrap,
  isUpdateIdleTrayStatus,
  resolveUpdateRuntimeRoot,
} from "./bootstrap.js";
import { grokRuntimeRoot } from "../runtime/runtime-paths.js";
import {
  RuntimeStore,
  seedCompleteInstall,
} from "../runtime/runtime-store.js";

describe("createGatewayUpdateHealth", () => {
  it("fails closed when the gateway is absent or not ready", async () => {
    const absent = createGatewayUpdateHealth(() => null);
    await expect(absent.probeGateway()).resolves.toMatchObject({
      ok: false,
      code: "gateway_not_ready",
    });
    await expect(absent.probeAuthStatus()).resolves.toMatchObject({
      ok: false,
      code: "gateway_not_ready",
    });

    let requested = false;
    const starting = createGatewayUpdateHealth(() => ({
      getStatus: () => "starting",
      request: async () => {
        requested = true;
      },
    }));
    await expect(starting.probeGateway()).resolves.toMatchObject({
      ok: false,
      code: "gateway_not_ready",
    });
    expect(requested).toBe(false);
  });

  it("proves gateway and auth RPC responsiveness independently", async () => {
    const methods: string[] = [];
    const health = createGatewayUpdateHealth(() => ({
      getStatus: () => "ready",
      request: async (method: string) => {
        methods.push(method);
        return { ok: true };
      },
    }));

    await expect(health.probeGateway()).resolves.toEqual({
      ok: true,
      detail: "tray.status responsive",
    });
    await expect(health.probeAuthStatus()).resolves.toEqual({
      ok: true,
      detail: "auth.status responsive",
    });
    await expect(health.probeMain()).resolves.toEqual({
      ok: true,
      detail: "in_process",
    });
    expect(methods).toEqual(["tray.status", "auth.status"]);
  });

  it("reports RPC failures instead of accepting deferred health", async () => {
    const health = createGatewayUpdateHealth(() => ({
      getStatus: () => "ready",
      request: async (method: string) => {
        throw new Error(`${method} failed`);
      },
    }));

    await expect(health.probeGateway()).resolves.toMatchObject({
      ok: false,
      code: "gateway_rpc_failed",
      message: "tray.status failed",
    });
    await expect(health.probeAuthStatus()).resolves.toMatchObject({
      ok: false,
      code: "auth_status_failed",
      message: "auth.status failed",
    });
  });
});

describe("resolveUpdateRuntimeRoot", () => {
  it("resolves runtimes/grok under userData", () => {
    const root = resolveUpdateRuntimeRoot("/tmp/user-data");
    expect(root).toBe(grokRuntimeRoot("/tmp/user-data"));
    expect(root).toContain(path.join("runtimes", "grok"));
  });

  it("rejects empty userData", () => {
    expect(() => resolveUpdateRuntimeRoot("")).toThrow();
  });
});

describe("isUpdateIdleTrayStatus", () => {
  it("treats idle and paused as idle", () => {
    expect(isUpdateIdleTrayStatus("idle")).toBe(true);
    expect(isUpdateIdleTrayStatus("paused")).toBe(true);
  });

  it("treats working and needs_you as busy", () => {
    expect(isUpdateIdleTrayStatus("working")).toBe(false);
    expect(isUpdateIdleTrayStatus("needs_you")).toBe(false);
    for (const s of ACTIVE_TRAY_STATUSES) {
      expect(isUpdateIdleTrayStatus(s)).toBe(false);
    }
  });

  it("treats null/undefined as idle (pre-gateway)", () => {
    expect(isUpdateIdleTrayStatus(null)).toBe(true);
    expect(isUpdateIdleTrayStatus(undefined)).toBe(true);
    expect(isUpdateIdleTrayStatus("")).toBe(true);
  });
});

describe("applyManagedGrokBinaryEnv", () => {
  it("sets absolute path and returns it", () => {
    const env: NodeJS.ProcessEnv = {};
    const abs = path.join(os.tmpdir(), "managed-grok-bin");
    expect(applyManagedGrokBinaryEnv(abs, env)).toBe(abs);
    expect(env[MANAGED_GROK_BINARY_ENV]).toBe(abs);
  });

  it("clears env when path is missing or relative", () => {
    const env: NodeJS.ProcessEnv = {
      [MANAGED_GROK_BINARY_ENV]: "/old/path",
    };
    expect(applyManagedGrokBinaryEnv(null, env)).toBeNull();
    expect(env[MANAGED_GROK_BINARY_ENV]).toBeUndefined();

    env[MANAGED_GROK_BINARY_ENV] = "/old/path";
    expect(applyManagedGrokBinaryEnv("relative/bin", env)).toBeNull();
    expect(env[MANAGED_GROK_BINARY_ENV]).toBeUndefined();
  });

  it("trims whitespace", () => {
    const env: NodeJS.ProcessEnv = {};
    const abs = path.join(os.tmpdir(), "grok-trim");
    applyManagedGrokBinaryEnv(`  ${abs}  `, env);
    expect(env[MANAGED_GROK_BINARY_ENV]).toBe(abs);
  });
});

describe("createRebuildGatewayHandler", () => {
  const abs = path.join(os.tmpdir(), "rebuild-gateway-bin");

  it("sets managed binary env then stop+start when gateway is ready", async () => {
    const env: NodeJS.ProcessEnv = {};
    const calls: string[] = [];
    const gw = {
      setManagedBinaryPath: (binaryPath: string) => {
        calls.push(`set:${binaryPath}`);
      },
      stop: async () => {
        calls.push("stop");
      },
      start: async () => {
        calls.push("start");
      },
    };
    const rebuild = createRebuildGatewayHandler({
      getGateway: () => gw,
      env,
    });

    await rebuild(abs);

    expect(env[MANAGED_GROK_BINARY_ENV]).toBe(abs);
    expect(calls).toEqual([`set:${abs}`, "stop", "start"]);
  });

  it("fails closed when gateway is not ready and leaves env unchanged", async () => {
    const env: NodeJS.ProcessEnv = {};
    const rebuild = createRebuildGatewayHandler({
      getGateway: () => null,
      env,
    });

    await expect(rebuild(abs)).rejects.toThrow(/gateway.*not ready/i);
    expect(env[MANAGED_GROK_BINARY_ENV]).toBeUndefined();
  });

  it("fails closed when getGateway returns undefined", async () => {
    const env: NodeJS.ProcessEnv = {};
    const rebuild = createRebuildGatewayHandler({
      getGateway: () => undefined,
      env,
    });
    await expect(rebuild(abs)).rejects.toThrow(/gateway.*not ready/i);
    expect(env[MANAGED_GROK_BINARY_ENV]).toBeUndefined();
  });

  it("rejects relative binary paths (PATH discovery never used)", async () => {
    const env: NodeJS.ProcessEnv = {
      [MANAGED_GROK_BINARY_ENV]: "/old",
    };
    const stop = async () => {
      throw new Error("should not stop");
    };
    const rebuild = createRebuildGatewayHandler({
      getGateway: () => ({
        setManagedBinaryPath: () => {},
        stop,
        start: async () => {},
      }),
      env,
    });

    await expect(rebuild("relative/grok")).rejects.toThrow(/absolute/i);
    // Invalid path clears managed env (same as applyManagedGrokBinaryEnv).
    expect(env[MANAGED_GROK_BINARY_ENV]).toBeUndefined();
  });

  it("propagates restart failures for pointer rollback", async () => {
    const env: NodeJS.ProcessEnv = {};
    const rebuild = createRebuildGatewayHandler({
      getGateway: () => ({
        setManagedBinaryPath: () => {},
        stop: async () => {},
        start: async () => {
          throw new Error("start failed");
        },
      }),
      env,
    });

    await expect(rebuild(abs)).rejects.toThrow(/start failed/);
    expect(env[MANAGED_GROK_BINARY_ENV]).toBe(abs);
  });

  it("trims binary path before setting env", async () => {
    const env: NodeJS.ProcessEnv = {};
    let restarted = false;
    const rebuild = createRebuildGatewayHandler({
      getGateway: () => ({
        setManagedBinaryPath: () => {},
        stop: async () => {
          restarted = true;
        },
        start: async () => {},
      }),
      env,
    });
    await rebuild(`  ${abs}  `);
    expect(env[MANAGED_GROK_BINARY_ENV]).toBe(abs);
    expect(restarted).toBe(true);
  });
});

describe("createUpdateBootstrap", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-update-boot-"));
    env = {};
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("requires userDataDir and deskVersion", () => {
    expect(() =>
      createUpdateBootstrap({
        userDataDir: "",
        deskVersion: "1.0.0",
        env,
      }),
    ).toThrow(/userDataDir/);
    expect(() =>
      createUpdateBootstrap({
        userDataDir: dir,
        deskVersion: "",
        env,
      }),
    ).toThrow(/deskVersion/);
  });

  it("recovers complete install and sets managed binary env", () => {
    const store = new RuntimeStore({ userData: dir });
    const ref = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
    });
    store.switchPointer({ current: ref, previous: null });

    const boot = createUpdateBootstrap({
      userDataDir: dir,
      deskVersion: "1.2.0",
      env,
      target: "darwin-arm64",
      isIdle: () => true,
      // Avoid network / electron-updater on start.
      resolvePair: async () => null,
    });

    const binary = store.binaryPath(ref.version, ref.target);
    expect(boot.getManagedBinaryPath()).toBe(binary);
    expect(env[MANAGED_GROK_BINARY_ENV]).toBe(binary);
    expect(boot.runtimeRoot).toBe(resolveUpdateRuntimeRoot(dir));
    expect(fs.existsSync(boot.runtimeRoot)).toBe(true);

    boot.stop();
  });

  it("leaves managed binary unset when no complete install", () => {
    const boot = createUpdateBootstrap({
      userDataDir: dir,
      deskVersion: "1.0.0",
      env,
      target: "darwin-arm64",
      isIdle: () => true,
      resolvePair: async () => null,
    });
    expect(boot.getManagedBinaryPath()).toBeNull();
    expect(env[MANAGED_GROK_BINARY_ENV]).toBeUndefined();
    boot.stop();
  });

  it("start runs scheduler recovery then stop clears timer", async () => {
    const boot = createUpdateBootstrap({
      userDataDir: dir,
      deskVersion: "1.0.0",
      env,
      target: "darwin-arm64",
      isIdle: () => true,
      resolvePair: async () => null,
      intervalMs: 60_000,
      jitterFraction: 0,
      random: () => 0.5,
    });

    await boot.start();
    expect(boot.scheduler.lastReason()).toBe("startup");
    expect(boot.scheduler.nextFireAt()).not.toBeNull();
    boot.stop();
    expect(boot.scheduler.nextFireAt()).toBeNull();
  });

  it("isIdle uses tray status when getTrayStatus provided", async () => {
    let tray = "working";
    const boot = createUpdateBootstrap({
      userDataDir: dir,
      deskVersion: "1.0.0",
      env,
      target: "darwin-arm64",
      getTrayStatus: () => tray,
      resolvePair: async () => null,
    });
    expect(await boot.coordinator.isIdle()).toBe(false);
    tray = "idle";
    expect(await boot.coordinator.isIdle()).toBe(true);
    boot.stop();
  });

  it("keeps production adapters null without manifest URL/keys", () => {
    const boot = createUpdateBootstrap({
      userDataDir: dir,
      deskVersion: "1.0.0",
      env,
      target: "darwin-arm64",
      isIdle: () => true,
    });
    expect(boot.productionAdapters).toBeNull();
    const readinessPath = env.GROKDESK_RUNTIME_READINESS_STATE_PATH;
    expect(readinessPath).toBeTruthy();
    const readiness = JSON.parse(fs.readFileSync(readinessPath!, "utf8")) as {
      managedRuntimeReady: boolean;
      updatesReady: boolean;
      reason: string;
    };
    expect(readiness).toMatchObject({
      managedRuntimeReady: false,
      updatesReady: false,
      reason: "managed_runtime_unavailable",
    });
    boot.stop();
  });

  it("persists update admission pause and resumes only after explicit cancel", async () => {
    const store = new RuntimeStore({ userData: dir });
    const ref = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
    });
    store.switchPointer({ current: ref, previous: null });
    const resolved = {
      pairId: "pair-1.1.0-0.9.5",
      channel: "stable" as const,
      target: "darwin-arm64" as const,
      deskVersion: "1.1.0",
      grokVersion: "0.9.5",
      deskArtifactId: "desk-1.1.0",
      grokArtifactId: "grok-0.9.5",
      capabilities: ["agent"],
      deskSha256: "d".repeat(64),
      grokSha256: "c".repeat(64),
      deskSizeBytes: 20,
      grokSizeBytes: 10,
      manifestSequence: 2,
      manifestPayloadSha256: "b".repeat(64),
      updateKind: "paired" as const,
      allowDeskDowngrade: false,
    };
    const boot = createUpdateBootstrap({
      userDataDir: dir,
      deskVersion: "1.0.0",
      env,
      runtimeStore: store,
      target: "darwin-arm64",
      isIdle: () => false,
      resolvePair: async () => resolved,
      stageGrok: async () => ({
        ok: true,
        switched: false,
        staged: {
          kind: "grok",
          artifactId: resolved.grokArtifactId,
          version: resolved.grokVersion,
          digestSha256: resolved.grokSha256,
          sizeBytes: resolved.grokSizeBytes,
          path: path.join(dir, "staged-grok"),
        },
      }),
      stageDesk: async () => ({
        ok: true,
        staged: {
          kind: "desk",
          artifactId: resolved.deskArtifactId,
          version: resolved.deskVersion,
          digestSha256: resolved.deskSha256,
          sizeBytes: resolved.deskSizeBytes,
          path: path.join(dir, "staged-desk"),
        },
      }),
      switchGrokRuntime: async () => ({ ok: true, previous: null }),
      installDeskOnRestart: async () => ({ ok: true, willRestart: true }),
    });
    const readinessPath = env.GROKDESK_RUNTIME_READINESS_STATE_PATH!;
    expect(JSON.parse(fs.readFileSync(readinessPath, "utf8"))).toMatchObject({
      managedRuntimeReady: true,
      updatesReady: true,
      admissionPaused: false,
      reason: "ready",
    });

    expect((await boot.coordinator.checkAndStage()).ok).toBe(true);
    const waiting = await boot.coordinator.approveRestart();
    expect(waiting.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(readinessPath, "utf8"))).toMatchObject({
      admissionPaused: true,
      reason: "admission_paused",
    });

    expect((await boot.coordinator.approveRestart("cancel")).ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(readinessPath, "utf8"))).toMatchObject({
      admissionPaused: false,
      reason: "ready",
    });
    boot.stop();
  });
});
