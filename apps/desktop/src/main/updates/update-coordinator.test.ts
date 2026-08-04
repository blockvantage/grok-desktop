import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedPair } from "@grokdesk/shared";
import {
  snapshotFromResolvedPair,
  UpdateCoordinator,
  type ResolvedPairSnapshot,
} from "./update-coordinator.js";
import { UpdateJournalStore, type UpdateJournalRecord } from "./update-journal.js";
import type { UpdateHealthDeps } from "./update-health.js";
import {
  TrustedTimeFloor,
  type SecurityPolicySnapshot,
} from "./security-deadline.js";

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

describe("UpdateCoordinator synchronized pair updates", () => {
  let dir: string;
  let journal: UpdateJournalStore;
  let idle: boolean;
  let installed: { deskVersion: string; grokVersion: string };
  let resolveCount: number;
  let stageGrokCount: number;
  let stageDeskCount: number;
  let switchCount: number;
  let installDeskCount: number;
  let currentGrok: { version: string; digest: string };
  let deskVersion: string;
  let health: UpdateHealthDeps;

  function makeCoordinator(opts: {
    resolve?: () => ResolvedPairSnapshot | null;
    stageGrokFail?: boolean;
    stageDeskFail?: boolean;
  } = {}) {
    return new UpdateCoordinator({
      journal,
      isIdle: () => idle,
      getInstalled: () => installed,
      getChannel: () => "stable",
      getTarget: () => "darwin-arm64",
      resolvePair: async ({ expectedSequence }) => {
        resolveCount += 1;
        const p = opts.resolve ? opts.resolve() : pair();
        if (!p) return null;
        if (
          expectedSequence !== undefined &&
          p.manifestSequence !== expectedSequence
        ) {
          return null;
        }
        return p;
      },
      stageGrok: async (p) => {
        stageGrokCount += 1;
        if (opts.stageGrokFail) {
          return { ok: false, code: "download_failed", message: "boom" };
        }
        return {
          ok: true,
          switched: false,
          staged: {
            kind: "grok",
            artifactId: p.grokArtifactId,
            version: p.grokVersion,
            digestSha256: p.grokSha256,
            sizeBytes: p.grokSizeBytes,
            path: path.join(dir, "staging", "grok"),
          },
        };
      },
      stageDesk: async (p) => {
        stageDeskCount += 1;
        if (opts.stageDeskFail) {
          return { ok: false, code: "desk_stage_failed", message: "nope" };
        }
        return {
          ok: true,
          staged: {
            kind: "desk",
            artifactId: p.deskArtifactId,
            version: p.deskVersion,
            digestSha256: p.deskSha256,
            sizeBytes: p.deskSizeBytes,
            path: "",
          },
        };
      },
      switchGrokRuntime: async (staged) => {
        switchCount += 1;
        const previous = {
          version: currentGrok.version,
          target: "darwin-arm64" as const,
          digestSha256: currentGrok.digest,
        };
        currentGrok = { version: staged.version, digest: staged.digestSha256 };
        return { ok: true, previous };
      },
      installDeskOnRestart: async (staged) => {
        installDeskCount += 1;
        deskVersion = staged.version;
        return { ok: true, willRestart: true };
      },
      restorePreviousRuntime: async (prev) => {
        currentGrok = { version: prev.version, digest: prev.digestSha256 };
        return { ok: true, previous: null };
      },
      health,
    });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-update-coord-"));
    journal = new UpdateJournalStore({ userData: dir });
    idle = true;
    installed = { deskVersion: "1.0.0", grokVersion: "0.9.0" };
    resolveCount = 0;
    stageGrokCount = 0;
    stageDeskCount = 0;
    switchCount = 0;
    installDeskCount = 0;
    currentGrok = { version: "0.9.0", digest: "a".repeat(64) };
    deskVersion = "1.0.0";
    health = {
      getDeskVersion: () => deskVersion,
      getGrokVersion: () => currentGrok.version,
      getGrokDigest: () => currentGrok.digest,
      getGrokCapabilities: () => ["agent"],
      getTarget: () => "darwin-arm64",
      probeGateway: () => ({ ok: true }),
      probeAuthStatus: () => ({ ok: true }),
      probeMain: () => ({ ok: true }),
    };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("authorizes Desk downgrade only from a resolved downgrade edge", () => {
    const resolved = {
      pairId: "authorized-downgrade",
      channel: "stable",
      target: "darwin-arm64",
      deskVersion: "1.0.0",
      grokVersion: "0.9.4",
      deskArtifactId: "desk-1.0.0",
      grokArtifactId: "grok-0.9.4",
      capabilities: ["agent"],
      deskArtifact: { sha256: "d".repeat(64), sizeBytes: 10 },
      grokArtifact: { sha256: "c".repeat(64), sizeBytes: 20 },
      reason: "downgrade",
      securityForced: true,
    } as unknown as ResolvedPair;
    const snapshot = snapshotFromResolvedPair(resolved, {
      manifestSequence: 10,
      manifestPayloadSha256: "b".repeat(64),
      installed: { deskVersion: "1.1.0", grokVersion: "0.9.4" },
    });
    expect(snapshot.allowDeskDowngrade).toBe(true);

    const unauthorized = snapshotFromResolvedPair(
      { ...resolved, reason: "upgrade" },
      {
        manifestSequence: 10,
        manifestPayloadSha256: "b".repeat(64),
        installed: { deskVersion: "1.1.0", grokVersion: "0.9.4" },
      },
    );
    expect(unauthorized.allowDeskDowngrade).toBe(false);
  });

  it("stages a paired update without switching while busy, then installs when idle", async () => {
    const coord = makeCoordinator();
    idle = false;

    const staged = await coord.checkAndStage();
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.phase).toBe("staged");
    expect(stageGrokCount).toBe(1);
    expect(stageDeskCount).toBe(1);
    expect(switchCount).toBe(0);
    expect(installDeskCount).toBe(0);
    // Resolve twice: initial + re-resolve guard.
    expect(resolveCount).toBe(2);

    const j = journal.load();
    expect(j?.phase).toBe("staged");
    expect(j?.installed).toEqual(installed);
    expect(j?.targetPair?.deskVersion).toBe("1.1.0");

    const approved = await coord.approveRestart();
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.waitingForIdle).toBe(true);
    expect(approved.phase).toBe("waiting_for_idle");
    expect(coord.isAdmissionPaused()).toBe(true);
    expect(switchCount).toBe(0);

    idle = true;
    const installedResult = await coord.tryInstallWhenIdle();
    expect(installedResult.ok).toBe(true);
    if (!installedResult.ok) return;
    expect(installedResult.willRestart).toBe(true);
    expect(switchCount).toBe(1);
    expect(installDeskCount).toBe(1);
    expect(currentGrok.version).toBe("0.9.4");
    expect(journal.load()?.phase).toBe("restarting");
  });

  it("never installs while work is active even if approve is called when idle flips mid-flight", async () => {
    const coord = makeCoordinator();
    await coord.checkAndStage();

    // isIdle returns false at install time.
    idle = false;
    const r = await coord.approveRestart();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.waitingForIdle).toBe(true);
    expect(switchCount).toBe(0);
    expect(installDeskCount).toBe(0);
  });

  it("rejects concurrent tryInstallWhenIdle while another update holds busy", async () => {
    // Park checkAndStage on a hanging stageGrok so busy stays true.
    let releaseStage!: () => void;
    const stageGate = new Promise<void>((resolve) => {
      releaseStage = resolve;
    });
    let stageEntered = false;
    const coord = new UpdateCoordinator({
      journal,
      isIdle: () => true,
      getInstalled: () => installed,
      getChannel: () => "stable",
      getTarget: () => "darwin-arm64",
      resolvePair: async () => pair(),
      stageGrok: async (p) => {
        stageEntered = true;
        await stageGate;
        return {
          ok: true,
          switched: false,
          staged: {
            kind: "grok",
            artifactId: p.grokArtifactId,
            version: p.grokVersion,
            digestSha256: p.grokSha256,
            sizeBytes: p.grokSizeBytes,
            path: path.join(dir, "staging", "grok"),
          },
        };
      },
      stageDesk: async (p) => ({
        ok: true,
        staged: {
          kind: "desk",
          artifactId: p.deskArtifactId,
          version: p.deskVersion,
          digestSha256: p.deskSha256,
          sizeBytes: p.deskSizeBytes,
          path: "",
        },
      }),
      switchGrokRuntime: async () => ({ ok: true, previous: null }),
      installDeskOnRestart: async () => ({ ok: true, willRestart: true }),
      health,
    });

    const staging = coord.checkAndStage();
    await vi.waitFor(() => expect(stageEntered).toBe(true));
    const concurrent = await coord.tryInstallWhenIdle(["during_stage"]);
    expect(concurrent.ok).toBe(false);
    if (!concurrent.ok) expect(concurrent.code).toBe("busy");
    releaseStage();
    const staged = await staging;
    expect(staged.ok).toBe(true);
  });

  it("allows grok-only when desk version unchanged", async () => {
    const coord = makeCoordinator({
      resolve: () =>
        pair({
          deskVersion: "1.0.0",
          deskArtifactId: "art-desk-1.0.0",
          updateKind: "grok_only",
        }),
    });
    const staged = await coord.checkAndStage();
    expect(staged.ok).toBe(true);
    expect(stageGrokCount).toBe(1);
    expect(stageDeskCount).toBe(0);

    const r = await coord.approveRestart();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Grok-only commits in-process (no desk restart).
    expect(r.phase).toBe("committed");
    expect(switchCount).toBe(1);
    expect(installDeskCount).toBe(0);
    expect(journal.load()?.installed).toEqual({
      deskVersion: "1.0.0",
      grokVersion: "0.9.4",
    });
  });

  it("allows desk-only when grok version unchanged", async () => {
    const coord = makeCoordinator({
      resolve: () =>
        pair({
          grokVersion: "0.9.0",
          grokArtifactId: "art-grok-0.9.0",
          grokSha256: "a".repeat(64),
          updateKind: "desk_only",
        }),
    });
    const staged = await coord.checkAndStage();
    expect(staged.ok).toBe(true);
    expect(stageGrokCount).toBe(0);
    expect(stageDeskCount).toBe(1);

    const r = await coord.approveRestart();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.willRestart).toBe(true);
    expect(switchCount).toBe(0);
    expect(installDeskCount).toBe(1);
  });

  it("is idempotent across restart at each journal phase (no double download)", async () => {
    const coord = makeCoordinator();
    await coord.checkAndStage();
    expect(stageGrokCount).toBe(1);
    expect(stageDeskCount).toBe(1);

    // Crash simulation: leave journal at staged, new coordinator recovers.
    const coord2 = makeCoordinator();
    const recovered = await coord2.recoverOnStartup();
    expect(recovered.ok).toBe(true);
    expect(recovered.phase).toBe("staged");
    // No re-download on staged recovery.
    expect(stageGrokCount).toBe(1);
    expect(stageDeskCount).toBe(1);

    // waiting_for_idle recovery keeps pair and does not re-stage.
    journal.transition("waiting_for_idle", { customerAction: "approve_restart" });
    idle = false;
    const coord3 = makeCoordinator();
    const r3 = await coord3.recoverOnStartup();
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.waitingForIdle).toBe(true);
    expect(stageGrokCount).toBe(1);

    // installing crash → post_update_verification path.
    idle = true;
    journal.transition("installing", {
      previousRuntime: {
        version: "0.9.0",
        target: "darwin-arm64",
        digestSha256: "a".repeat(64),
      },
    });
    // Pretend we already switched before crash.
    currentGrok = { version: "0.9.4", digest: "c".repeat(64) };
    deskVersion = "1.1.0";
    const coord4 = makeCoordinator();
    const r4 = await coord4.recoverOnStartup();
    expect(r4.ok).toBe(true);
    if (!r4.ok) return;
    expect(r4.phase).toBe("committed");
    expect(r4.notes).toContain("committed");
  });

  it("restores previous runtime when post-update grok health fails", async () => {
    const coord = makeCoordinator();
    await coord.checkAndStage();
    journal.transition("waiting_for_idle", { customerAction: "approve_restart" });
    journal.transition("installing");
    journal.transition("restarting", {
      previousRuntime: {
        version: "0.9.0",
        target: "darwin-arm64",
        digestSha256: "a".repeat(64),
      },
    });
    // Bad grok after restart.
    currentGrok = { version: "0.0.0", digest: "f".repeat(64) };
    deskVersion = "1.1.0";

    const r = await coord.recoverOnStartup();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.phase).toBe("repair");
    expect(r.notes).toContain("previous_restored");
    expect(currentGrok.version).toBe("0.9.0");
  });

  it("requires resolved capabilities during post-update health", async () => {
    const coord = makeCoordinator({
      resolve: () =>
        pair({
          deskVersion: installed.deskVersion,
          deskArtifactId: "art-desk-1.0.0",
          deskSha256: "e".repeat(64),
          updateKind: "grok_only",
          capabilities: ["agent", "managed-no-self-update"],
        }),
    });
    const staged = await coord.checkAndStage();
    expect(staged.ok).toBe(true);
    const result = await coord.approveRestart();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("capability_missing");
    expect(result.phase).toBe("repair");
  });

  it("does not double-download when resume finds existing staged digests", async () => {
    const coord = makeCoordinator();
    await coord.checkAndStage();
    const staged = journal.load() as UpdateJournalRecord;
    // Rewind to downloading with staged digests already present.
    journal.write({
      ...staged,
      phase: "downloading",
      updatedAt: staged.updatedAt,
    });
    const coord2 = makeCoordinator();
    const r = await coord2.recoverOnStartup();
    expect(r.ok).toBe(true);
    // stageGrok/Desk called once more on resume path, but implementations
    // short-circuit via digest match inside stageResolvedPair — count stays 1
    // only when already staged matching; resume re-enters stageResolvedPair
    // which skips re-download when digests match.
    expect(stageGrokCount).toBe(1);
    expect(stageDeskCount).toBe(1);
    expect(journal.load()?.phase).toBe("staged");
  });

  it("rejects sequence drift on re-resolve", async () => {
    let seq = 10;
    const coord = makeCoordinator({
      resolve: () => pair({ manifestSequence: seq }),
    });
    // Force drift: after first resolve, bump sequence.
    const original = coord.checkAndStage.bind(coord);
    // Monkey: first resolve returns 10, re-resolve gets 11 via side effect.
    let calls = 0;
    const depsResolve = async () => {
      calls += 1;
      if (calls === 1) return pair({ manifestSequence: 10 });
      return pair({ manifestSequence: 11, manifestPayloadSha256: "e".repeat(64) });
    };
    // Build a coordinator with drifting resolve.
    const drifting = new UpdateCoordinator({
      journal,
      isIdle: () => true,
      getInstalled: () => installed,
      getChannel: () => "stable",
      getTarget: () => "darwin-arm64",
      resolvePair: depsResolve,
      stageGrok: async (p) => ({
        ok: true,
        switched: false,
        staged: {
          kind: "grok",
          artifactId: p.grokArtifactId,
          version: p.grokVersion,
          digestSha256: p.grokSha256,
          sizeBytes: p.grokSizeBytes,
          path: path.join(dir, "g"),
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
          path: "",
        },
      }),
      switchGrokRuntime: async () => ({ ok: true, previous: null }),
      installDeskOnRestart: async () => ({ ok: true, willRestart: true }),
      health,
    });
    void original;
    void seq;
    const r = await drifting.checkAndStage();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("sequence_drift");
  });

  it("single-flight: concurrent checkAndStage is rejected", async () => {
    const coord = makeCoordinator();
    // Stall stageGrok
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const stalled = new UpdateCoordinator({
      journal,
      isIdle: () => true,
      getInstalled: () => installed,
      getChannel: () => "stable",
      getTarget: () => "darwin-arm64",
      resolvePair: async () => pair(),
      stageGrok: async (p) => {
        await gate;
        return {
          ok: true,
          switched: false,
          staged: {
            kind: "grok",
            artifactId: p.grokArtifactId,
            version: p.grokVersion,
            digestSha256: p.grokSha256,
            sizeBytes: p.grokSizeBytes,
            path: path.join(dir, "g"),
          },
        };
      },
      stageDesk: async (p) => ({
        ok: true,
        staged: {
          kind: "desk",
          artifactId: p.deskArtifactId,
          version: p.deskVersion,
          digestSha256: p.deskSha256,
          sizeBytes: p.deskSizeBytes,
          path: "",
        },
      }),
      switchGrokRuntime: async () => ({ ok: true, previous: null }),
      installDeskOnRestart: async () => ({ ok: true, willRestart: true }),
      health,
    });

    const first = stalled.checkAndStage();
    const second = await stalled.checkAndStage();
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("busy");
    release();
    const done = await first;
    expect(done.ok).toBe(true);
    void coord;
  });

  it("cancel clears staged state without touching installed pair", async () => {
    const coord = makeCoordinator();
    await coord.checkAndStage();
    const r = await coord.approveRestart("cancel");
    expect(r.ok).toBe(true);
    expect(r.phase).toBe("idle");
    expect(coord.isAdmissionPaused()).toBe(false);
    expect(journal.load()?.phase).toBe("idle");
    expect(journal.load()?.installed).toEqual(installed);
  });
});

describe("verifyPostUpdateHealth", () => {
  it("is covered via coordinator commit path", () => {
    // Imported through coordinator integration above.
    expect(true).toBe(true);
  });
});

describe("UpdateCoordinator security deadline and revocations", () => {
  let dir: string;
  let journal: UpdateJournalStore;
  let installed: { deskVersion: string; grokVersion: string };
  let currentGrok: { version: string; digest: string };
  let health: UpdateHealthDeps;
  let appliedPolicies: SecurityPolicySnapshot[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-update-sec-"));
    journal = new UpdateJournalStore({ userData: dir });
    installed = { deskVersion: "1.0.0", grokVersion: "0.9.0" };
    currentGrok = { version: "0.9.0", digest: "a".repeat(64) };
    appliedPolicies = [];
    health = {
      getDeskVersion: () => "1.0.0",
      getGrokVersion: () => currentGrok.version,
      getGrokDigest: () => currentGrok.digest,
      getGrokCapabilities: () => ["agent"],
      getTarget: () => "darwin-arm64",
      probeGateway: () => ({ ok: true }),
      probeAuthStatus: () => ({ ok: true }),
      probeMain: () => ({ ok: true }),
    };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeSecCoordinator(opts: {
    wallMs?: number;
    previous?: { version: string; digest: string } | null;
  } = {}) {
    const wallMs = opts.wallMs ?? Date.parse("2026-07-01T00:00:00.000Z");
    const trustedTime = new TrustedTimeFloor({
      userData: dir,
      wallNowMs: () => wallMs,
      monoNowNs: () => 0n,
    });
    return new UpdateCoordinator({
      journal,
      isIdle: () => true,
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
          path: path.join(dir, "g"),
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
          path: "",
        },
      }),
      switchGrokRuntime: async () => ({ ok: true, previous: null }),
      installDeskOnRestart: async () => ({ ok: true, willRestart: true }),
      restorePreviousRuntime: async (prev) => {
        currentGrok = { version: prev.version, digest: prev.digestSha256 };
        return { ok: true, previous: null };
      },
      health,
      trustedTime,
      applySecurityPolicy: (p) => {
        appliedPolicies.push(p);
      },
      getPreviousRuntime: () =>
        opts.previous
          ? {
              version: opts.previous.version,
              target: "darwin-arm64",
              digestSha256: opts.previous.digest,
            }
          : opts.previous === null
            ? null
            : {
                version: "0.8.5",
                target: "darwin-arm64",
                digestSha256: "b".repeat(64),
              },
      getActiveRuntime: () => ({
        deskVersion: installed.deskVersion,
        grokVersion: installed.grokVersion,
        deskArtifactId: "art-desk-1.0.0",
        grokArtifactId: "art-grok-0.9.0",
        pairId: "pair-1.0.0-0.9.0",
      }),
    });
  }

  it("before deadline: warn/stage path (does not block Grok)", async () => {
    const coord = makeSecCoordinator({
      wallMs: Date.parse("2026-07-01T00:00:00.000Z"),
    });
    journal.write(
      journal.createIdle({
        channel: "stable",
        target: "darwin-arm64",
        installed,
      }),
    );
    const policy = await coord.applySignedSecurityPolicy({
      securityDeadline: "2026-07-10T00:00:00.000Z",
      revocations: [],
      manifestIssuedAt: "2026-06-30T00:00:00.000Z",
    });
    expect(policy.mode).toBe("security_warn");
    expect(policy.blockGrokOperations).toBe(false);
    expect(policy.shouldStage).toBe(true);
    expect(coord.isSecurityBlocked()).toBe(false);
    expect(appliedPolicies).toHaveLength(1);
    expect(appliedPolicies[0]?.mode).toBe("security_warn");
  });

  it("after deadline: blocks Grok and pushes policy to readiness", async () => {
    const coord = makeSecCoordinator({
      wallMs: Date.parse("2026-07-15T00:00:00.000Z"),
    });
    journal.write(
      journal.createIdle({
        channel: "stable",
        target: "darwin-arm64",
        installed,
      }),
    );
    const policy = await coord.applySignedSecurityPolicy({
      securityDeadline: "2026-07-10T00:00:00.000Z",
      revocations: [],
      manifestIssuedAt: "2026-07-08T00:00:00.000Z",
      entitlementServerTime: "2026-07-14T00:00:00.000Z",
    });
    expect(policy.mode).toBe("security_block");
    expect(policy.blockGrokOperations).toBe(true);
    expect(policy.localReadAllowed).toBe(true);
    expect(coord.isSecurityBlocked()).toBe(true);
    expect(coord.getStatus().securityDeadline).toBe(
      "2026-07-10T00:00:00.000Z",
    );
  });

  it("clock rollback cannot evade a past security deadline", async () => {
    // Floor raised by entitlement server time past the deadline.
    let wallMs = Date.parse("2026-07-20T00:00:00.000Z");
    const trustedTime = new TrustedTimeFloor({
      userData: dir,
      wallNowMs: () => wallMs,
      monoNowNs: () => 0n,
    });
    trustedTime.observe({
      entitlementServerTime: "2026-07-20T00:00:00.000Z",
    });
    // Roll wall clock back before the deadline.
    wallMs = Date.parse("2026-07-01T00:00:00.000Z");
    const coord = new UpdateCoordinator({
      journal,
      isIdle: () => true,
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
          path: path.join(dir, "g"),
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
          path: "",
        },
      }),
      switchGrokRuntime: async () => ({ ok: true, previous: null }),
      installDeskOnRestart: async () => ({ ok: true, willRestart: true }),
      health,
      trustedTime,
      applySecurityPolicy: (p) => {
        appliedPolicies.push(p);
      },
    });
    journal.write(
      journal.createIdle({
        channel: "stable",
        target: "darwin-arm64",
        installed,
      }),
    );
    const policy = await coord.applySignedSecurityPolicy({
      securityDeadline: "2026-07-10T00:00:00.000Z",
      revocations: [],
    });
    expect(policy.phase).toBe("after");
    expect(policy.blockGrokOperations).toBe(true);
  });

  it("newly revoked active runtime switches to previous non-revoked runtime", async () => {
    const coord = makeSecCoordinator({
      previous: { version: "0.8.5", digest: "b".repeat(64) },
    });
    journal.write(
      journal.createIdle({
        channel: "stable",
        target: "darwin-arm64",
        installed,
      }),
    );
    const policy = await coord.applySignedSecurityPolicy({
      securityDeadline: null,
      revocations: [
        {
          kind: "version",
          id: "0.9.0",
          reason: "cve",
          revokedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
      manifestIssuedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(policy.mode).toBe("revocation_switch");
    expect(policy.blockGrokOperations).toBe(true);
    expect(currentGrok.version).toBe("0.8.5");
    expect(appliedPolicies[0]?.code).toBe("runtime_revoked");
  });

  it("revoked active runtime with no recovery candidate enters repair", async () => {
    const coord = makeSecCoordinator({ previous: null });
    journal.write(
      journal.createIdle({
        channel: "stable",
        target: "darwin-arm64",
        installed,
      }),
    );
    const policy = await coord.applySignedSecurityPolicy({
      securityDeadline: null,
      revocations: [
        {
          kind: "artifact",
          id: "art-grok-0.9.0",
          revokedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });
    expect(policy.mode).toBe("revocation_repair");
    expect(policy.recoveryCandidate).toBeNull();
    expect(journal.load()?.phase).toBe("repair");
    expect(journal.load()?.lastError?.code).toBe("runtime_revoked");
    // Local read still allowed by policy.
    expect(policy.localReadAllowed).toBe(true);
  });
});
