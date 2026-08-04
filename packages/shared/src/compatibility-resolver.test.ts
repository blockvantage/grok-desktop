import { describe, it, expect } from "vitest";
import {
  compareSemver,
  isInRolloutCohort,
  resolvePair,
  type ResolvePairInput,
} from "./compatibility-resolver.js";
import type {
  CompatibilityManifestPayload,
  CompatibilityPair,
  ReleaseArtifact,
} from "./compatibility-manifest.js";
import { sampleManifest } from "./compatibility-manifest.test.js";

const SHA =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function artifact(
  kind: "desk" | "grok",
  version: string,
  target: ReleaseArtifact["target"] = "darwin-arm64",
  channel: ReleaseArtifact["channel"] = "stable",
): ReleaseArtifact {
  return {
    artifactId: `${kind}-${version}-${target}`,
    kind,
    version,
    target,
    channel,
    grantEndpoint: "/v1/download-grants",
    sizeBytes: 2048,
    sha256: SHA,
    provenance: {
      source: "official",
      retrievedAt: "2026-07-01T00:00:00.000Z",
    },
    signingPolicy: { requirePlatformSignature: true },
    capabilities: ["agent", "managed-no-self-update"],
  };
}

function pair(
  deskVersion: string,
  grokVersion: string,
  opts: Partial<CompatibilityPair> = {},
): CompatibilityPair {
  const target = opts.target ?? "darwin-arm64";
  const channel = opts.channel ?? "stable";
  return {
    pairId:
      opts.pairId ??
      `${channel}-${target}-${deskVersion}-${grokVersion}`,
    channel,
    target,
    deskVersion,
    grokVersion,
    deskArtifactId: opts.deskArtifactId ?? `desk-${deskVersion}-${target}`,
    grokArtifactId: opts.grokArtifactId ?? `grok-${grokVersion}-${target}`,
    capabilities: opts.capabilities ?? ["agent", "managed-no-self-update"],
    recommended: opts.recommended,
  };
}

function installed(
  overrides: Partial<ResolvePairInput> = {},
): ResolvePairInput {
  return {
    target: "darwin-arm64",
    channel: "stable",
    installedDeskVersion: "1.1.0",
    installedGrokVersion: "0.9.0",
    deviceCohortId: "device-cohort-a",
    now: Date.parse("2026-07-10T00:00:00.000Z"),
    ...overrides,
  };
}

describe("compareSemver", () => {
  it("orders prereleases below releases", () => {
    expect(compareSemver("1.2.0-beta.1", "1.2.0")).toBeLessThan(0);
    expect(compareSemver("1.2.0", "1.2.0-beta.1")).toBeGreaterThan(0);
    expect(compareSemver("1.2.0-beta.2", "1.2.0-beta.1")).toBeGreaterThan(0);
    expect(compareSemver("1.2.0", "1.2.0")).toBe(0);
  });

  it("does not use string inequality for multi-digit versions", () => {
    // String compare would claim "1.10.0" < "1.9.0"
    expect("1.10.0" < "1.9.0").toBe(true);
    expect(compareSemver("1.10.0", "1.9.0")).toBeGreaterThan(0);
  });
});

describe("resolvePair", () => {
  it("resolves the signed stable pair for an installed stable client", () => {
    const manifest = sampleManifest();
    const installedStable = installed({
      installedDeskVersion: "1.1.0",
      installedGrokVersion: "0.9.0",
      channel: "stable",
    });
    expect(resolvePair(manifest, installedStable)).toMatchObject({
      deskVersion: "1.2.0",
      grokVersion: "0.9.4",
    });
  });

  it("does not select beta pairs without channel opt-in", () => {
    const betaDesk = artifact("desk", "1.3.0-beta.1", "darwin-arm64", "beta");
    const betaGrok = artifact("grok", "0.10.0-beta.1", "darwin-arm64", "beta");
    const manifestWithOnlyBeta = sampleManifest({
      channels: {
        stable: { desk: [], grok: [], pairs: [] },
        beta: {
          desk: [betaDesk],
          grok: [betaGrok],
          pairs: [
            pair("1.3.0-beta.1", "0.10.0-beta.1", {
              channel: "beta",
              deskArtifactId: betaDesk.artifactId,
              grokArtifactId: betaGrok.artifactId,
            }),
          ],
        },
      },
    });
    const installedStable = installed({ channel: "stable" });
    expect(resolvePair(manifestWithOnlyBeta, installedStable)).toBeNull();
  });

  it("selects beta pairs only when the channel is opted in", () => {
    const betaDesk = artifact("desk", "1.3.0-beta.1", "darwin-arm64", "beta");
    const betaGrok = artifact("grok", "0.10.0-beta.1", "darwin-arm64", "beta");
    const stableDesk = artifact("desk", "1.2.0");
    const stableGrok = artifact("grok", "0.9.4");
    const manifest: CompatibilityManifestPayload = sampleManifest({
      channels: {
        stable: {
          desk: [stableDesk],
          grok: [stableGrok],
          pairs: [
            pair("1.2.0", "0.9.4", {
              deskArtifactId: stableDesk.artifactId,
              grokArtifactId: stableGrok.artifactId,
            }),
          ],
        },
        beta: {
          desk: [betaDesk],
          grok: [betaGrok],
          pairs: [
            pair("1.3.0-beta.1", "0.10.0-beta.1", {
              channel: "beta",
              deskArtifactId: betaDesk.artifactId,
              grokArtifactId: betaGrok.artifactId,
              recommended: true,
            }),
          ],
        },
      },
    });
    expect(
      resolvePair(manifest, installed({ channel: "beta" })),
    ).toMatchObject({
      deskVersion: "1.3.0-beta.1",
      grokVersion: "0.10.0-beta.1",
      channel: "beta",
    });
    expect(
      resolvePair(manifest, installed({ channel: "stable" })),
    ).toMatchObject({
      deskVersion: "1.2.0",
      grokVersion: "0.9.4",
      channel: "stable",
    });
  });

  it("uses SemVer prerelease precedence when choosing among pairs", () => {
    const deskA = artifact("desk", "1.2.0-beta.1");
    const deskB = artifact("desk", "1.2.0");
    const grokA = artifact("grok", "0.9.4-beta.1");
    const grokB = artifact("grok", "0.9.4");
    const manifest = sampleManifest({
      channels: {
        stable: {
          desk: [deskA, deskB],
          grok: [grokA, grokB],
          pairs: [
            pair("1.2.0-beta.1", "0.9.4-beta.1", {
              deskArtifactId: deskA.artifactId,
              grokArtifactId: grokA.artifactId,
            }),
            pair("1.2.0", "0.9.4", {
              deskArtifactId: deskB.artifactId,
              grokArtifactId: grokB.artifactId,
              recommended: true,
            }),
          ],
        },
      },
    });
    expect(resolvePair(manifest, installed())).toMatchObject({
      deskVersion: "1.2.0",
      grokVersion: "0.9.4",
    });
  });

  it("never invents an independently latest desk+grok combination", () => {
    // Highest desk is paired with older grok; highest grok with older desk.
    const d13 = artifact("desk", "1.3.0");
    const d12 = artifact("desk", "1.2.0");
    const g10 = artifact("grok", "0.10.0");
    const g09 = artifact("grok", "0.9.4");
    const manifest = sampleManifest({
      channels: {
        stable: {
          desk: [d13, d12],
          grok: [g10, g09],
          pairs: [
            pair("1.3.0", "0.9.4", {
              deskArtifactId: d13.artifactId,
              grokArtifactId: g09.artifactId,
            }),
            pair("1.2.0", "0.10.0", {
              deskArtifactId: d12.artifactId,
              grokArtifactId: g10.artifactId,
            }),
          ],
        },
      },
    });
    const resolved = resolvePair(manifest, installed());
    expect(resolved).not.toBeNull();
    // Must be one of the exact pairs, never 1.3.0+0.10.0
    expect([
      `${resolved!.deskVersion}+${resolved!.grokVersion}`,
    ]).not.toContain("1.3.0+0.10.0");
    expect(
      ["1.3.0+0.9.4", "1.2.0+0.10.0"].includes(
        `${resolved!.deskVersion}+${resolved!.grokVersion}`,
      ),
    ).toBe(true);
  });

  it("returns null for missing or unpublished targets", () => {
    const manifest = sampleManifest();
    expect(
      resolvePair(
        manifest,
        installed({ target: "linux-x64" as never }),
      ),
    ).toBeNull();
    expect(
      resolvePair(manifest, installed({ target: "unsupported" })),
    ).toBeNull();
    // win32-arm64 exists as a type but is unpublished in launch manifests
    expect(
      resolvePair(manifest, installed({ target: "win32-arm64" })),
    ).toBeNull();
  });

  it("honors rollout cohort and lets security deadline override percentage", () => {
    const desk = artifact("desk", "1.2.0");
    const grok = artifact("grok", "0.9.4");
    const base = sampleManifest({
      channels: {
        stable: {
          desk: [desk],
          grok: [grok],
          pairs: [
            pair("1.2.0", "0.9.4", {
              deskArtifactId: desk.artifactId,
              grokArtifactId: grok.artifactId,
            }),
          ],
        },
      },
      rollout: { basisPoints: 0, salt: "closed-rollout" },
      securityDeadline: null,
    });

    // 0% rollout excludes everyone for optional upgrades
    expect(
      resolvePair(
        base,
        installed({
          deviceCohortId: "any-device",
          installedDeskVersion: "1.1.0",
        }),
      ),
    ).toBeNull();

    // Cohort membership can include devices when basis points > 0
    const partial = {
      ...base,
      rollout: { basisPoints: 5000, salt: "half-rollout" },
    };
    let includedId: string | null = null;
    let excludedId: string | null = null;
    for (let i = 0; i < 256; i++) {
      const id = `probe-${i}`;
      if (isInRolloutCohort(id, "half-rollout", 5000)) {
        includedId ??= id;
      } else {
        excludedId ??= id;
      }
      if (includedId && excludedId) break;
    }
    expect(includedId).toBeTruthy();
    expect(excludedId).toBeTruthy();
    expect(
      resolvePair(partial, installed({ deviceCohortId: includedId! })),
    ).toMatchObject({ deskVersion: "1.2.0", grokVersion: "0.9.4" });
    expect(
      resolvePair(partial, installed({ deviceCohortId: excludedId! })),
    ).toBeNull();

    // Security deadline forces the pair even at 0% rollout
    const forced = {
      ...base,
      rollout: { basisPoints: 0, salt: "closed-rollout" },
      securityDeadline: "2026-07-05T00:00:00.000Z",
    };
    expect(
      resolvePair(
        forced,
        installed({
          deviceCohortId: "outside-cohort",
          now: Date.parse("2026-07-10T00:00:00.000Z"),
        }),
      ),
    ).toMatchObject({
      deskVersion: "1.2.0",
      grokVersion: "0.9.4",
      securityForced: true,
    });
  });

  it("excludes revoked versions and artifacts", () => {
    const desk = artifact("desk", "1.2.0");
    const grok = artifact("grok", "0.9.4");
    const olderDesk = artifact("desk", "1.1.5");
    const olderGrok = artifact("grok", "0.9.1");
    const manifest = sampleManifest({
      channels: {
        stable: {
          desk: [desk, olderDesk],
          grok: [grok, olderGrok],
          pairs: [
            pair("1.2.0", "0.9.4", {
              deskArtifactId: desk.artifactId,
              grokArtifactId: grok.artifactId,
            }),
            pair("1.1.5", "0.9.1", {
              deskArtifactId: olderDesk.artifactId,
              grokArtifactId: olderGrok.artifactId,
            }),
          ],
        },
      },
      revocations: [
        {
          kind: "version",
          id: "1.2.0",
          revokedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });
    expect(resolvePair(manifest, installed())).toMatchObject({
      deskVersion: "1.1.5",
      grokVersion: "0.9.1",
    });

    const byArtifact = sampleManifest({
      channels: {
        stable: {
          desk: [desk],
          grok: [grok],
          pairs: [
            pair("1.2.0", "0.9.4", {
              deskArtifactId: desk.artifactId,
              grokArtifactId: grok.artifactId,
            }),
          ],
        },
      },
      revocations: [
        {
          kind: "artifact",
          id: desk.artifactId,
          revokedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });
    expect(resolvePair(byArtifact, installed())).toBeNull();
  });

  it("requires an authorized downgrade edge when version precedence decreases", () => {
    const lowerDesk = artifact("desk", "1.1.0");
    const lowerGrok = artifact("grok", "0.9.0");
    const higherDesk = artifact("desk", "1.2.0-beta.1", "darwin-arm64", "beta");
    const higherGrok = artifact("grok", "0.10.0-beta.1", "darwin-arm64", "beta");

    const withoutEdge = sampleManifest({
      channels: {
        stable: {
          desk: [lowerDesk],
          grok: [lowerGrok],
          pairs: [
            pair("1.1.0", "0.9.0", {
              deskArtifactId: lowerDesk.artifactId,
              grokArtifactId: lowerGrok.artifactId,
            }),
          ],
        },
        beta: {
          desk: [higherDesk],
          grok: [higherGrok],
          pairs: [
            pair("1.2.0-beta.1", "0.10.0-beta.1", {
              channel: "beta",
              deskArtifactId: higherDesk.artifactId,
              grokArtifactId: higherGrok.artifactId,
            }),
          ],
        },
      },
      authorizedDowngradeEdges: [],
    });

    // Returning from beta to stable with lower precedence needs an edge
    expect(
      resolvePair(
        withoutEdge,
        installed({
          channel: "stable",
          installedDeskVersion: "1.2.0-beta.1",
          installedGrokVersion: "0.10.0-beta.1",
        }),
      ),
    ).toBeNull();

    const withEdge = sampleManifest({
      channels: withoutEdge.channels,
      authorizedDowngradeEdges: [
        {
          fromDeskVersion: "1.2.0-beta.1",
          toDeskVersion: "1.1.0",
          fromGrokVersion: "0.10.0-beta.1",
          toGrokVersion: "0.9.0",
          target: "darwin-arm64",
          channel: "stable",
          reason: "leave-beta",
        },
      ],
    });
    expect(
      resolvePair(
        withEdge,
        installed({
          channel: "stable",
          installedDeskVersion: "1.2.0-beta.1",
          installedGrokVersion: "0.10.0-beta.1",
        }),
      ),
    ).toMatchObject({
      deskVersion: "1.1.0",
      grokVersion: "0.9.0",
      reason: "downgrade",
    });
  });

  it("returns the current pair when already on the recommended stable pair", () => {
    const manifest = sampleManifest();
    expect(
      resolvePair(
        manifest,
        installed({
          installedDeskVersion: "1.2.0",
          installedGrokVersion: "0.9.4",
        }),
      ),
    ).toMatchObject({
      deskVersion: "1.2.0",
      grokVersion: "0.9.4",
      reason: "current",
    });
  });

  it("rejects pairs whose artifacts have wrong kind", () => {
    const desk = artifact("desk", "1.2.0");
    const grok = artifact("grok", "0.9.4");
    // deskArtifactId / grokArtifactId swapped → kinds do not match roles
    const swapped = sampleManifest({
      channels: {
        stable: {
          desk: [desk],
          grok: [grok],
          pairs: [
            pair("1.2.0", "0.9.4", {
              deskArtifactId: grok.artifactId,
              grokArtifactId: desk.artifactId,
            }),
          ],
        },
      },
    });
    expect(resolvePair(swapped, installed())).toBeNull();

    // Artifact listed under desk[] but kind is "grok"
    const mislabeled: ReleaseArtifact = { ...desk, kind: "grok" };
    const wrongKind = sampleManifest({
      channels: {
        stable: {
          desk: [mislabeled],
          grok: [grok],
          pairs: [
            pair("1.2.0", "0.9.4", {
              deskArtifactId: mislabeled.artifactId,
              grokArtifactId: grok.artifactId,
            }),
          ],
        },
      },
    });
    expect(resolvePair(wrongKind, installed())).toBeNull();
  });

  it("rejects pairs whose artifact channel does not match the pair channel", () => {
    const betaTaggedDesk: ReleaseArtifact = {
      ...artifact("desk", "1.2.0", "darwin-arm64", "beta"),
      artifactId: "desk-1.2.0-darwin-arm64",
    };
    const betaTaggedGrok: ReleaseArtifact = {
      ...artifact("grok", "0.9.4", "darwin-arm64", "beta"),
      artifactId: "grok-0.9.4-darwin-arm64",
    };
    const channelMismatch = sampleManifest({
      channels: {
        stable: {
          desk: [betaTaggedDesk],
          grok: [betaTaggedGrok],
          pairs: [
            pair("1.2.0", "0.9.4", {
              channel: "stable",
              deskArtifactId: betaTaggedDesk.artifactId,
              grokArtifactId: betaTaggedGrok.artifactId,
            }),
          ],
        },
      },
    });
    expect(resolvePair(channelMismatch, installed({ channel: "stable" }))).toBeNull();
  });

  it("prefers artifacts from the pair channel catalog when ids collide", () => {
    const stableDesk = artifact("desk", "1.2.0", "darwin-arm64", "stable");
    const stableGrok = artifact("grok", "0.9.4", "darwin-arm64", "stable");
    // Same artifact ids exist on beta with different sizes (identity collision).
    // Without preferred-channel lookup, global search would always hit stable first.
    const betaDesk: ReleaseArtifact = {
      ...stableDesk,
      channel: "beta",
      sizeBytes: 9999,
    };
    const betaGrok: ReleaseArtifact = {
      ...stableGrok,
      channel: "beta",
      sizeBytes: 8888,
    };
    const collision = sampleManifest({
      channels: {
        stable: {
          desk: [stableDesk],
          grok: [stableGrok],
          pairs: [
            pair("1.2.0", "0.9.4", {
              deskArtifactId: stableDesk.artifactId,
              grokArtifactId: stableGrok.artifactId,
            }),
          ],
        },
        beta: {
          desk: [betaDesk],
          grok: [betaGrok],
          pairs: [
            pair("1.2.0", "0.9.4", {
              channel: "beta",
              deskArtifactId: betaDesk.artifactId,
              grokArtifactId: betaGrok.artifactId,
            }),
          ],
        },
      },
    });
    const betaResolved = resolvePair(collision, installed({ channel: "beta" }));
    expect(betaResolved).not.toBeNull();
    expect(betaResolved!.channel).toBe("beta");
    expect(betaResolved!.deskArtifact.channel).toBe("beta");
    expect(betaResolved!.grokArtifact.channel).toBe("beta");
    expect(betaResolved!.deskArtifact.sizeBytes).toBe(9999);
    expect(betaResolved!.grokArtifact.sizeBytes).toBe(8888);

    const stableResolved = resolvePair(
      collision,
      installed({ channel: "stable" }),
    );
    expect(stableResolved).not.toBeNull();
    expect(stableResolved!.deskArtifact.channel).toBe("stable");
    expect(stableResolved!.grokArtifact.sizeBytes).toBe(stableGrok.sizeBytes);
  });
});

describe("isInRolloutCohort", () => {
  it("is deterministic for the same device cohort id and salt", () => {
    const a = isInRolloutCohort("device-1", "salt-x", 2500);
    const b = isInRolloutCohort("device-1", "salt-x", 2500);
    expect(a).toBe(b);
  });

  it("includes everyone at 10000 and nobody at 0", () => {
    expect(isInRolloutCohort("device-1", "salt", 10000)).toBe(true);
    expect(isInRolloutCohort("device-1", "salt", 0)).toBe(false);
  });
});
