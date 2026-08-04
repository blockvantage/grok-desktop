import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RuntimeManager,
  stagingArtifactDir,
  type InstallRuntimeRequest,
} from "./runtime-manager.js";
import { RuntimeStore, seedCompleteInstall } from "./runtime-store.js";
import { installJournalPath, stagingDir } from "./runtime-paths.js";
import type { PlatformSigningResult } from "./runtime-types.js";
import type { ProbeRunResult } from "./runtime-verifier.js";

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function probeOk(stdout: string): ProbeRunResult {
  return {
    code: 0,
    stdout,
    stderr: "",
    durationMs: 3,
    timedOut: false,
  };
}

describe("runtime-manager install transaction", () => {
  let userData: string;
  let store: RuntimeStore;
  let stagingBinary: string;
  const version = "0.9.4";
  const target = "darwin-arm64" as const;
  const content = Buffer.from("managed-grok-0.9.4-binary\n");
  const digest = sha256Hex(content);

  const goodSig: PlatformSigningResult = {
    checked: true,
    valid: true,
    teamId: "TEAM1",
  };

  function baseRequest(
    overrides: Partial<InstallRuntimeRequest> = {},
  ): InstallRuntimeRequest {
    return {
      stagingBinaryPath: stagingBinary,
      artifactId: "art-grok-0.9.4",
      version,
      target,
      expectedSha256: digest,
      expectedSizeBytes: content.length,
      provenance: {
        source: "test-mirror",
        retrievedAt: "2026-07-16T12:00:00.000Z",
        officialUrl: "https://example.com/grok",
      },
      signingPolicy: {
        requirePlatformSignature: true,
        macTeamId: "TEAM1",
      },
      requiredCapabilities: ["agent", "managed-no-self-update"],
      declaredCapabilities: ["agent", "managed-no-self-update"],
      manifestSequence: 42,
      manifestKeyId: "release-1",
      switchWhenIdle: true,
      ...overrides,
    };
  }

  function makeManager(opts: {
    idle?: boolean | (() => boolean);
    rebuildGateway?: (bin: string) => void | Promise<void>;
    signature?: PlatformSigningResult;
  } = {}) {
    const idleFn =
      typeof opts.idle === "function"
        ? opts.idle
        : () => opts.idle !== false;
    return new RuntimeManager({
      store,
      isIdle: idleFn,
      rebuildGateway: opts.rebuildGateway,
      verifierDeps: {
        platform: "darwin",
        verifySignature: async () => opts.signature ?? goodSig,
        setExecutable: (p) => {
          try {
            fs.chmodSync(p, 0o755);
          } catch {
            /* win */
          }
        },
        runProbe: async (_bin, args) => {
          if (args[0] === "--version") return probeOk(`grok ${version}`);
          if (args[0] === "--help") {
            return probeOk("usage agent managed-no-self-update");
          }
          if (args[0] === "agent") return probeOk("agent help");
          return {
            code: 1,
            stdout: "",
            stderr: "bad",
            durationMs: 1,
            timedOut: false,
          };
        },
      },
    });
  }

  beforeEach(() => {
    userData = fs.mkdtempSync(
      path.join(os.tmpdir(), "grokdesk-runtime-manager-"),
    );
    store = new RuntimeStore({ userData });
    store.ensureLayout();
    const destDir = stagingArtifactDir(userData, "art-grok-0.9.4");
    fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
    stagingBinary = path.join(destDir, "grok");
    fs.writeFileSync(stagingBinary, content, { mode: 0o600 });
  });

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("promotes verified artifact, writes installation.json, switches when idle", async () => {
    const rebuild = vi.fn();
    const mgr = makeManager({ idle: true, rebuildGateway: rebuild });
    const result = await mgr.install(baseRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.switched).toBe(true);
    expect(result.waitingForIdle).toBe(false);
    expect(result.ref.version).toBe(version);
    expect(result.ref.digestSha256).toBe(digest);
    expect(result.record.complete).toBe(true);
    expect(result.record.manifestSequence).toBe(42);
    expect(result.record.platformSigning.valid).toBe(true);

    const binary = store.binaryPath(version, target);
    expect(fs.existsSync(binary)).toBe(true);
    expect(sha256Hex(fs.readFileSync(binary))).toBe(digest);
    expect(fs.existsSync(store.installationPath(version, target))).toBe(true);

    const ptr = store.loadPointer();
    expect(ptr.ok).toBe(true);
    if (ptr.ok) {
      expect(ptr.pointer.current.version).toBe(version);
      expect(ptr.pointer.current.digestSha256).toBe(digest);
    }

    expect(rebuild).toHaveBeenCalledWith(binary);
    // Journal cleared on success.
    expect(fs.existsSync(installJournalPath(userData))).toBe(false);
    // Staging binary moved out.
    expect(fs.existsSync(stagingBinary)).toBe(false);
  });

  it("rejects download metadata that disagrees with the manifest request", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("download must not start");
    }) as unknown as typeof fetch;
    const mgr = makeManager({ idle: true });
    const request = baseRequest();
    const result = await mgr.installFromDownload({
      ...request,
      download: {
        artifactId: request.artifactId,
        url: "https://updates.example.com/grok",
        expectedSize: request.expectedSizeBytes + 1,
        expectedSha256: "0".repeat(64),
        allowedHosts: ["updates.example.com"],
        destDir: path.dirname(stagingBinary),
      },
      downloadOptions: { fetchImpl },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never switches while work is active; leaves complete install + waiting journal", async () => {
    const rebuild = vi.fn();
    const mgr = makeManager({ idle: false, rebuildGateway: rebuild });
    const result = await mgr.install(baseRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.switched).toBe(false);
    expect(result.waitingForIdle).toBe(true);
    expect(result.record.complete).toBe(true);
    expect(rebuild).not.toHaveBeenCalled();

    // Pointer absent / unchanged.
    const ptr = store.loadPointer();
    expect(ptr.ok).toBe(false);

    const journal = mgr.loadJournal();
    expect(journal?.state).toBe("waiting_for_idle");
    expect(journal?.version).toBe(version);

    // Later, when idle, recover switches.
    const mgr2 = makeManager({ idle: true, rebuildGateway: rebuild });
    const recovered = await mgr2.recoverInstallJournal();
    expect(recovered.action).toBe("switched_on_recover");
    expect(recovered.installResult?.ok).toBe(true);
    if (recovered.installResult?.ok) {
      expect(recovered.installResult.switched).toBe(true);
    }
    const ptr2 = store.loadPointer();
    expect(ptr2.ok).toBe(true);
    if (ptr2.ok) expect(ptr2.pointer.current.version).toBe(version);
  });

  it("optional switchWhenIdle=false installs without pointer switch", async () => {
    const mgr = makeManager({ idle: true });
    const result = await mgr.install(
      baseRequest({ switchWhenIdle: false }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.switched).toBe(false);
    expect(result.waitingForIdle).toBe(false);
    expect(store.loadPointer().ok).toBe(false);
    expect(store.isCompleteVerifiedInstall(result.ref).ok).toBe(true);
  });

  it("pre-switch verify failure preserves current pointer", async () => {
    const current = seedCompleteInstall(store, {
      version: "0.9.3",
      target,
      content: "old-binary",
    });
    store.switchPointer({ current, previous: null });

    const mgr = makeManager({
      idle: true,
      signature: {
        checked: true,
        valid: false,
        detail: "wrong_team_id",
      },
    });
    const result = await mgr.install(baseRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("verify_failed");
    expect(result.pointerPreserved).toBe(true);

    const ptr = store.loadPointer();
    expect(ptr.ok).toBe(true);
    if (ptr.ok) {
      expect(ptr.pointer.current.version).toBe("0.9.3");
      expect(ptr.pointer.current.digestSha256).toBe(current.digestSha256);
    }
    // New version must not be complete.
    expect(store.loadInstallation(version, target)?.complete).not.toBe(true);
  });

  it("sets previous to prior current on switch", async () => {
    const prev = seedCompleteInstall(store, {
      version: "0.9.3",
      target,
      content: "prev",
    });
    store.switchPointer({ current: prev, previous: null });

    const mgr = makeManager({ idle: true });
    const result = await mgr.install(baseRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pointer?.current.version).toBe(version);
    expect(result.pointer?.previous?.version).toBe("0.9.3");
  });

  it("post-switch gateway rebuild failure restores previous pointer", async () => {
    const prev = seedCompleteInstall(store, {
      version: "0.9.3",
      target,
      content: "prev-bin",
    });
    store.switchPointer({ current: prev, previous: null });

    let calls = 0;
    const mgr = makeManager({
      idle: true,
      rebuildGateway: async (bin) => {
        calls += 1;
        // Fail first rebuild (new), succeed on rollback rebuild.
        if (calls === 1) {
          throw new Error("gateway rebuild boom");
        }
        expect(bin).toBe(store.binaryPath("0.9.3", target));
      },
    });

    const result = await mgr.install(baseRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("gateway_rebuild_failed");
    expect(result.notes).toEqual(
      expect.arrayContaining(["rolling_back", "rolled_back"]),
    );

    const ptr = store.loadPointer();
    expect(ptr.ok).toBe(true);
    if (ptr.ok) {
      expect(ptr.pointer.current.version).toBe("0.9.3");
    }
    // New install remains on disk as complete (side-by-side) but not selected.
    expect(store.loadInstallation(version, target)?.complete).toBe(true);
  });

  it("recover abandons pre-install journal states without touching pointer", async () => {
    const current = seedCompleteInstall(store, {
      version: "0.9.3",
      target,
      content: "stable",
    });
    store.switchPointer({ current, previous: null });

    const mgr = makeManager({ idle: true });
    // Simulate crash during verifying.
    fs.writeFileSync(
      installJournalPath(userData),
      JSON.stringify({
        schemaVersion: 1,
        state: "verifying",
        artifactId: "art-x",
        version: "0.9.9",
        target,
        digestSha256: "b".repeat(64),
        sizeBytes: 1,
        updatedAt: new Date().toISOString(),
        manifestSequence: 1,
        manifestKeyId: "k",
        switchWhenIdle: true,
      }),
    );

    const recovered = await mgr.recoverInstallJournal();
    expect(recovered.action).toBe("abandoned_pre_install");
    expect(fs.existsSync(installJournalPath(userData))).toBe(false);

    const ptr = store.loadPointer();
    expect(ptr.ok).toBe(true);
    if (ptr.ok) expect(ptr.pointer.current.version).toBe("0.9.3");
  });

  it("trySwitchInstalled refuses when not idle", async () => {
    const mgr = makeManager({ idle: true });
    const installed = await mgr.install(baseRequest({ switchWhenIdle: false }));
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;

    const busy = makeManager({ idle: false });
    const sw = await busy.trySwitchInstalled(installed.ref);
    expect(sw.ok).toBe(false);
    if (sw.ok) return;
    expect(sw.code).toBe("not_idle");
  });

  it("idempotent reinstall of same digest succeeds", async () => {
    const mgr = makeManager({ idle: true });
    const first = await mgr.install(baseRequest());
    expect(first.ok).toBe(true);

    // Re-stage same bytes.
    const destDir = stagingArtifactDir(userData, "art-grok-0.9.4");
    fs.mkdirSync(destDir, { recursive: true });
    stagingBinary = path.join(destDir, "grok");
    fs.writeFileSync(stagingBinary, content);

    const second = await mgr.install(baseRequest());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.notes).toEqual(expect.arrayContaining(["already_installed"]));
  });

  it("journal refs include waiting version for GC retain", async () => {
    const mgr = makeManager({ idle: false });
    const result = await mgr.install(baseRequest());
    expect(result.ok).toBe(true);
    const journal = mgr.loadJournal();
    expect(journal?.version).toBe(version);
    // staging dir still present under runtimes
    expect(fs.existsSync(stagingDir(userData))).toBe(true);
  });
});
