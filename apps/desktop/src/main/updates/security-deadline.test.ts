import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Revocation } from "@grokdesk/shared";
import {
  TRUSTED_TIME_FILENAME,
  TrustedTimeFloor,
  evaluateSecurityPolicy,
  isActiveRevoked,
  isRuntimeRevoked,
  trustedTimePath,
  type SecurityPolicySnapshot,
} from "./security-deadline.js";

describe("trustedTimePath", () => {
  it("lives under userData/updates (PATH standard layout)", () => {
    expect(trustedTimePath("/data/user")).toBe(
      path.join("/data/user", "updates", TRUSTED_TIME_FILENAME),
    );
  });
});

describe("TrustedTimeFloor", () => {
  let dir: string;
  let wallMs: number;
  let monoNs: bigint;
  let floor: TrustedTimeFloor;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-trusted-time-"));
    wallMs = Date.parse("2026-07-01T12:00:00.000Z");
    monoNs = 1_000_000_000n; // 1s
    floor = new TrustedTimeFloor({
      userData: dir,
      wallNowMs: () => wallMs,
      monoNowNs: () => monoNs,
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("uses wall time as the initial floor", () => {
    const now = floor.nowMs();
    expect(now).toBe(wallMs);
    expect(floor.getFloorMs()).toBe(wallMs);
  });

  it("raises the floor from signed manifest issuedAt", () => {
    floor.observe({
      manifestIssuedAt: "2026-07-10T00:00:00.000Z",
    });
    expect(floor.getFloorMs()).toBe(Date.parse("2026-07-10T00:00:00.000Z"));
    expect(floor.nowMs()).toBe(Date.parse("2026-07-10T00:00:00.000Z"));
  });

  it("raises the floor from entitlement API server time", () => {
    floor.observe({
      entitlementServerTime: "2026-07-05T08:00:00.000Z",
    });
    expect(floor.getFloorMs()).toBe(Date.parse("2026-07-05T08:00:00.000Z"));
  });

  it("never moves the floor backward on wall-clock rollback", () => {
    floor.observe({ wallMs: Date.parse("2026-07-15T00:00:00.000Z") });
    expect(floor.getFloorMs()).toBe(Date.parse("2026-07-15T00:00:00.000Z"));

    // Attacker rolls OS clock back by a year.
    wallMs = Date.parse("2025-01-01T00:00:00.000Z");
    const now = floor.nowMs();
    expect(now).toBeGreaterThanOrEqual(Date.parse("2026-07-15T00:00:00.000Z"));
    expect(floor.getFloorMs()).toBe(Date.parse("2026-07-15T00:00:00.000Z"));
  });

  it("advances with monotonic elapsed time even when wall is frozen", () => {
    floor.observe({ wallMs: Date.parse("2026-07-01T12:00:00.000Z") });
    // Freeze wall, advance monotonic by 2 hours.
    monoNs = monoNs + 2n * 60n * 60n * 1_000_000_000n;
    const now = floor.nowMs();
    expect(now).toBe(
      Date.parse("2026-07-01T12:00:00.000Z") + 2 * 60 * 60 * 1000,
    );
    // Floor itself also ratchets forward from mono evidence.
    expect(floor.getFloorMs()).toBe(now);
  });

  it("takes the max of wall, manifest issued, entitlement server, and mono", () => {
    wallMs = Date.parse("2026-07-01T00:00:00.000Z");
    floor.observe({
      wallMs,
      manifestIssuedAt: "2026-07-03T00:00:00.000Z",
      entitlementServerTime: "2026-07-02T00:00:00.000Z",
    });
    // mono still at origin → floor is max = manifest issued
    expect(floor.getFloorMs()).toBe(Date.parse("2026-07-03T00:00:00.000Z"));

    monoNs = monoNs + 5n * 24n * 60n * 60n * 1_000_000_000n; // +5 days from origin wall
    // mono-based = wall_origin + 5d. Origin is first observe wall or initial.
    const monoBased = floor.nowMs();
    expect(monoBased).toBeGreaterThanOrEqual(
      Date.parse("2026-07-03T00:00:00.000Z"),
    );
  });

  it("persists only time evidence and reloads without moving floor backward", () => {
    floor.observe({
      wallMs: Date.parse("2026-07-20T00:00:00.000Z"),
      manifestIssuedAt: "2026-07-18T00:00:00.000Z",
      entitlementServerTime: "2026-07-19T00:00:00.000Z",
    });
    const file = path.join(dir, "updates", TRUSTED_TIME_FILENAME);
    expect(fs.existsSync(file)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    // Persist only time evidence / source — no secrets or policy decisions.
    expect(raw.schemaVersion).toBe(1);
    expect(typeof raw.floorMs).toBe("number");
    expect(raw).not.toHaveProperty("lease");
    expect(raw).not.toHaveProperty("productKey");
    expect(raw).not.toHaveProperty("privateKey");
    expect(raw).not.toHaveProperty("blockGrokOperations");

    // New process with rolled-back wall still respects persisted floor.
    wallMs = Date.parse("2020-01-01T00:00:00.000Z");
    const reloaded = new TrustedTimeFloor({
      userData: dir,
      wallNowMs: () => wallMs,
      monoNowNs: () => monoNs,
    });
    expect(reloaded.getFloorMs()).toBe(Date.parse("2026-07-20T00:00:00.000Z"));
    expect(reloaded.nowMs()).toBeGreaterThanOrEqual(
      Date.parse("2026-07-20T00:00:00.000Z"),
    );
  });

  it("ignores invalid / unparseable evidence", () => {
    const before = floor.getFloorMs();
    floor.observe({
      manifestIssuedAt: "not-a-date",
      entitlementServerTime: "",
      wallMs: Number.NaN,
    });
    expect(floor.getFloorMs()).toBe(before);
  });
});

describe("evaluateSecurityPolicy", () => {
  const baseActive = {
    deskVersion: "1.0.0",
    grokVersion: "0.9.0",
    deskArtifactId: "art-desk-1.0.0",
    grokArtifactId: "art-grok-0.9.0",
    pairId: "pair-1.0.0-0.9.0",
  };

  it("reports none when no deadline and no revocations", () => {
    const p = evaluateSecurityPolicy({
      trustedNowMs: Date.parse("2026-07-01T00:00:00.000Z"),
      securityDeadline: null,
      revocations: [],
      active: baseActive,
    });
    expect(p.phase).toBe("none");
    expect(p.mode).toBe("normal");
    expect(p.blockGrokOperations).toBe(false);
    expect(p.localReadAllowed).toBe(true);
    expect(p.activeRuntimeRevoked).toBe(false);
  });

  it("before deadline: warn / stage (do not block Grok ops)", () => {
    const p = evaluateSecurityPolicy({
      trustedNowMs: Date.parse("2026-07-01T00:00:00.000Z"),
      securityDeadline: "2026-07-10T00:00:00.000Z",
      revocations: [],
      active: baseActive,
    });
    expect(p.phase).toBe("before");
    expect(p.mode).toBe("security_warn");
    expect(p.blockGrokOperations).toBe(false);
    expect(p.localReadAllowed).toBe(true);
    expect(p.shouldStage).toBe(true);
  });

  it("after deadline: block new Grok ops while preserving local read/export", () => {
    const p = evaluateSecurityPolicy({
      trustedNowMs: Date.parse("2026-07-15T00:00:00.000Z"),
      securityDeadline: "2026-07-10T00:00:00.000Z",
      revocations: [],
      active: baseActive,
    });
    expect(p.phase).toBe("after");
    expect(p.mode).toBe("security_block");
    expect(p.blockGrokOperations).toBe(true);
    expect(p.localReadAllowed).toBe(true);
    expect(p.shouldStage).toBe(true);
    expect(p.code).toBe("security_deadline");
  });

  it("deadline equality counts as after (fail closed at exact deadline)", () => {
    const deadline = "2026-07-10T00:00:00.000Z";
    const p = evaluateSecurityPolicy({
      trustedNowMs: Date.parse(deadline),
      securityDeadline: deadline,
      revocations: [],
      active: baseActive,
    });
    expect(p.phase).toBe("after");
    expect(p.blockGrokOperations).toBe(true);
  });

  it("newly revoked active runtime with previous non-revoked candidate → switch", () => {
    const revocations: Revocation[] = [
      {
        kind: "version",
        id: "0.9.0",
        reason: "cve-2026-1",
        revokedAt: "2026-07-01T00:00:00.000Z",
      },
    ];
    const previous = {
      version: "0.8.5",
      target: "darwin-arm64" as const,
      digestSha256: "a".repeat(64),
      artifactId: "art-grok-0.8.5",
    };
    const p = evaluateSecurityPolicy({
      trustedNowMs: Date.parse("2026-07-02T00:00:00.000Z"),
      securityDeadline: null,
      revocations,
      active: baseActive,
      previousRuntime: previous,
    });
    expect(p.activeRuntimeRevoked).toBe(true);
    expect(p.mode).toBe("revocation_switch");
    expect(p.blockGrokOperations).toBe(true);
    expect(p.recoveryCandidate).toEqual({
      version: "0.8.5",
      target: "darwin-arm64",
      digestSha256: "a".repeat(64),
      artifactId: "art-grok-0.8.5",
    });
    expect(p.localReadAllowed).toBe(true);
    expect(p.code).toBe("runtime_revoked");
  });

  it("revoked active runtime with no recovery candidate → read-only repair", () => {
    const revocations: Revocation[] = [
      {
        kind: "artifact",
        id: "art-grok-0.9.0",
        revokedAt: "2026-07-01T00:00:00.000Z",
      },
    ];
    const p = evaluateSecurityPolicy({
      trustedNowMs: Date.parse("2026-07-02T00:00:00.000Z"),
      securityDeadline: null,
      revocations,
      active: baseActive,
      previousRuntime: null,
    });
    expect(p.activeRuntimeRevoked).toBe(true);
    expect(p.mode).toBe("revocation_repair");
    expect(p.blockGrokOperations).toBe(true);
    expect(p.recoveryCandidate).toBeNull();
    expect(p.localReadAllowed).toBe(true);
    expect(p.code).toBe("runtime_revoked");
  });

  it("previous runtime that is also revoked is not a recovery candidate", () => {
    const revocations: Revocation[] = [
      {
        kind: "version",
        id: "0.9.0",
        revokedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        kind: "version",
        id: "0.8.5",
        revokedAt: "2026-07-01T00:00:00.000Z",
      },
    ];
    const p = evaluateSecurityPolicy({
      trustedNowMs: Date.parse("2026-07-02T00:00:00.000Z"),
      securityDeadline: null,
      revocations,
      active: baseActive,
      previousRuntime: {
        version: "0.8.5",
        target: "darwin-arm64",
        digestSha256: "b".repeat(64),
      },
    });
    expect(p.mode).toBe("revocation_repair");
    expect(p.recoveryCandidate).toBeNull();
  });

  it("pair and artifact revocations match active ids", () => {
    expect(
      isActiveRevoked(
        [{ kind: "pair", id: "pair-x", revokedAt: "2026-01-01T00:00:00.000Z" }],
        { ...baseActive, pairId: "pair-x" },
      ),
    ).toBe(true);
    expect(
      isActiveRevoked(
        [
          {
            kind: "artifact",
            id: "art-desk-1.0.0",
            revokedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        baseActive,
      ),
    ).toBe(true);
    expect(
      isRuntimeRevoked(
        [
          {
            kind: "version",
            id: "0.8.5",
            revokedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        { version: "0.8.5" },
      ),
    ).toBe(true);
  });
});

describe("security policy immutability helpers", () => {
  it("snapshot always allows local read", () => {
    const snapshots: SecurityPolicySnapshot[] = [
      evaluateSecurityPolicy({
        trustedNowMs: 0,
        securityDeadline: "1970-01-02T00:00:00.000Z",
        revocations: [],
        active: {
          deskVersion: "1",
          grokVersion: "1",
        },
      }),
      evaluateSecurityPolicy({
        trustedNowMs: Date.now(),
        securityDeadline: null,
        revocations: [
          {
            kind: "version",
            id: "1",
            revokedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        active: { deskVersion: "1", grokVersion: "1" },
      }),
    ];
    for (const s of snapshots) {
      expect(s.localReadAllowed).toBe(true);
    }
  });
});
