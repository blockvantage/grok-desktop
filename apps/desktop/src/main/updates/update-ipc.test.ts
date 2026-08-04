import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMMERCE_CANARY_FIXTURES,
  UPDATE_MAIN_IPC_CHANNELS,
  type UpdateStatus,
} from "@grokdesk/shared";
import {
  UpdateCoordinator,
  type ResolvedPairSnapshot,
} from "./update-coordinator.js";
import { UpdateJournalStore } from "./update-journal.js";
import type { UpdateHealthDeps } from "./update-health.js";
import {
  assertNoUpdateSecrets,
  createUpdateIpcHandlers,
  dtoOmitsInternalUpdateFields,
  registerUpdateIpc,
  toSafeUpdateStatus,
  unregisterUpdateIpc,
  type IpcMainLike,
} from "./update-ipc.js";

const F = COMMERCE_CANARY_FIXTURES;

function pair(overrides: Partial<ResolvedPairSnapshot> = {}): ResolvedPairSnapshot {
  return {
    pairId: "pair-1.1.0-0.9.4",
    channel: "stable",
    target: "darwin-arm64",
    deskVersion: "1.1.0",
    grokVersion: "0.9.4",
    deskArtifactId: "art-desk-1.1.0",
    grokArtifactId: "art-grok-0.9.4",
    capabilities: ["agent"],
    deskSha256: "d".repeat(64),
    grokSha256: "c".repeat(64),
    deskSizeBytes: 200,
    grokSizeBytes: 100,
    manifestSequence: 10,
    manifestPayloadSha256: "b".repeat(64),
    updateKind: "paired",
    allowDeskDowngrade: false,
    ...overrides,
  };
}

describe("assertNoUpdateSecrets", () => {
  it("rejects product keys, grants, JWTs, and private keys", () => {
    expect(() =>
      assertNoUpdateSecrets({ msg: F.gd3 }, "canary"),
    ).toThrow(/product key/);
    expect(() =>
      assertNoUpdateSecrets({ grantToken: F.grantToken }, "canary"),
    ).toThrow(/grant/);
    expect(() =>
      assertNoUpdateSecrets({ lease: F.leaseJwt }, "canary"),
    ).toThrow(/JWT|lease/);
    expect(() =>
      assertNoUpdateSecrets({ privatePkcs8Base64: F.privatePkcs8Base64 }, "canary"),
    ).toThrow(/private key/);
  });

  it("rejects private runtime / staging paths", () => {
    expect(() =>
      assertNoUpdateSecrets(
        {
          path: "/Users/me/Library/Application Support/GrokDesk/runtimes/grok/1.0/darwin-arm64/grok",
        },
        "canary",
      ),
    ).toThrow(/path/);
    expect(() =>
      assertNoUpdateSecrets({ staging: "foo/staging/bar" }, "canary"),
    ).toThrow(/path/);
  });

  it("accepts a clean UpdateStatus", () => {
    const status: UpdateStatus = {
      phase: "staged",
      channel: "stable",
      target: "darwin-arm64",
      installed: { deskVersion: "1.0.0", grokVersion: "0.9.0" },
      available: {
        pairId: "p1",
        deskVersion: "1.1.0",
        grokVersion: "0.9.4",
        channel: "stable",
      },
      securityDeadline: "2026-08-01T00:00:00.000Z",
      securityMode: "security_warn",
    };
    expect(() => assertNoUpdateSecrets(status)).not.toThrow();
    expect(dtoOmitsInternalUpdateFields(status)).toBe(true);
    expect(toSafeUpdateStatus(status).phase).toBe("staged");
  });
});

describe("createUpdateIpcHandlers", () => {
  let dir: string;
  let journal: UpdateJournalStore;
  let idle: boolean;
  let installed: { deskVersion: string; grokVersion: string };
  let coord: UpdateCoordinator;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "update-ipc-"));
    journal = new UpdateJournalStore({ userData: dir });
    idle = true;
    installed = { deskVersion: "1.0.0", grokVersion: "0.9.0" };
    const health: UpdateHealthDeps = {
      getDeskVersion: () => installed.deskVersion,
      getGrokVersion: () => installed.grokVersion,
      getGrokDigest: () => "a".repeat(64),
      getGrokCapabilities: () => ["agent"],
      getTarget: () => "darwin-arm64",
      probeGateway: () => ({ ok: true }),
      probeAuthStatus: () => ({ ok: true }),
      probeMain: () => ({ ok: true }),
    };
    coord = new UpdateCoordinator({
      journal,
      isIdle: () => idle,
      getInstalled: () => installed,
      getChannel: () => "stable",
      getTarget: () => "darwin-arm64",
      resolvePair: async () => pair(),
      stageGrok: async (p) => ({
        ok: true,
        switched: false,
        staged: {
          kind: "grok",
          artifactId: p.grokArtifactId,
          version: p.grokVersion,
          digestSha256: p.grokSha256,
          sizeBytes: p.grokSizeBytes,
          // Internal path — must never appear in IPC status.
          path: path.join(dir, "runtimes", "grok", "staging", "grok"),
        },
      }),
      stageDesk: async (p) => ({
        ok: true,
        staged: {
          kind: "desk",
          artifactId: p.deskArtifactId,
          version: p.deskVersion,
          digestSha256: p.deskSha256,
          sizeBytes: p.deskSizeBytes,
          path: path.join(dir, "staging", "desk"),
        },
      }),
      switchGrokRuntime: async () => ({
        ok: true,
        previous: {
          version: installed.grokVersion,
          target: "darwin-arm64",
          digestSha256: "a".repeat(64),
        },
      }),
      installDeskOnRestart: async () => ({ ok: true, willRestart: true }),
      health,
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("status returns safe UpdateStatus DTO without secrets or paths", async () => {
    const handlers = createUpdateIpcHandlers({ getCoordinator: () => coord });
    const status = await handlers.status();
    assertNoUpdateSecrets(status);
    expect(dtoOmitsInternalUpdateFields(status)).toBe(true);
    expect(status.phase).toBe("idle");
    expect(status.channel).toBe("stable");
    const json = JSON.stringify(status);
    expect(json).not.toContain(F.gd3);
    expect(json).not.toContain(F.grantToken);
    expect(json).not.toContain(F.leaseJwt);
    expect(json).not.toContain("runtimes/grok");
    expect(json).not.toContain(dir);
  });

  it("check stages a pair and never returns grant/path material", async () => {
    const handlers = createUpdateIpcHandlers({ getCoordinator: () => coord });
    const result = await handlers.check();
    expect(result.ok).toBe(true);
    assertNoUpdateSecrets(result.status);
    expect(result.status.phase).toBe("staged");
    expect(result.status.available?.deskVersion).toBe("1.1.0");
    expect(result.status.available?.grokVersion).toBe("0.9.4");
    const json = JSON.stringify(result);
    expect(json).not.toContain(F.grantToken);
    expect(json).not.toContain("digestSha256");
    expect(json).not.toContain(path.join(dir, "staging"));
    expect(json).not.toMatch(/\/runtimes\/grok\//);
  });

  it("installRestart and cancel round-trip without secrets", async () => {
    const handlers = createUpdateIpcHandlers({ getCoordinator: () => coord });
    await handlers.check();
    idle = false;
    const install = await handlers.installRestart();
    expect(install.ok).toBe(true);
    expect(install.status.phase).toBe("waiting_for_idle");
    assertNoUpdateSecrets(install.status);

    const cancelled = await handlers.cancel();
    expect(cancelled.ok).toBe(true);
    expect(cancelled.status.phase).toBe("idle");
    assertNoUpdateSecrets(cancelled.status);
  });

  it("returns idle when coordinator is unavailable", async () => {
    const handlers = createUpdateIpcHandlers({ getCoordinator: () => null });
    const status = await handlers.status();
    expect(status.phase).toBe("idle");
    expect(status.target).toBe("unsupported");
    const check = await handlers.check();
    expect(check.ok).toBe(false);
    expect(check.code).toBe("not_ready");
  });

  it("registerUpdateIpc wires only safe channels (no security policy setter)", async () => {
    const handlers = createUpdateIpcHandlers({ getCoordinator: () => coord });
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain: IpcMainLike = {
      handle(channel, listener) {
        registered.set(channel, listener as (...args: unknown[]) => unknown);
      },
      removeHandler(channel) {
        registered.delete(channel);
      },
    };
    registerUpdateIpc(ipcMain, handlers, () => {
      /* trusted test sender */
    });
    expect(registered.has(UPDATE_MAIN_IPC_CHANNELS.status)).toBe(true);
    expect(registered.has(UPDATE_MAIN_IPC_CHANNELS.check)).toBe(true);
    expect(registered.has(UPDATE_MAIN_IPC_CHANNELS.installRestart)).toBe(true);
    expect(registered.has(UPDATE_MAIN_IPC_CHANNELS.cancel)).toBe(true);
    // Push channel is not a handle.
    expect(registered.has(UPDATE_MAIN_IPC_CHANNELS.statusChanged)).toBe(false);
    // No policy mutation.
    for (const ch of registered.keys()) {
      expect(ch).not.toMatch(/security|policy|setPolicy|apply/i);
      expect(ch).not.toMatch(/grant|path|manifest|url/i);
    }

    const status = await registered.get(UPDATE_MAIN_IPC_CHANNELS.status)!({});
    assertNoUpdateSecrets(status);

    unregisterUpdateIpc(ipcMain);
    expect(registered.size).toBe(0);
  });

  it("registerUpdateIpc fails closed when assertSender is missing", async () => {
    const handlers = createUpdateIpcHandlers({ getCoordinator: () => coord });
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain: IpcMainLike = {
      handle(channel, listener) {
        registered.set(channel, listener as (...args: unknown[]) => unknown);
      },
      removeHandler(channel) {
        registered.delete(channel);
      },
    };
    registerUpdateIpc(ipcMain, handlers);
    await expect(
      registered.get(UPDATE_MAIN_IPC_CHANNELS.installRestart)!({}),
    ).rejects.toThrow(/assertSender not configured/);
    unregisterUpdateIpc(ipcMain);
  });

  it("poisoned status with canaries is rejected by toSafeUpdateStatus", () => {
    const poisoned = {
      phase: "idle",
      channel: "stable",
      target: "darwin-arm64",
      error: {
        code: "x",
        message: `grant=${F.grantToken} key=${F.gd3}`,
      },
    } as UpdateStatus;
    expect(() => toSafeUpdateStatus(poisoned)).toThrow();
  });
});
