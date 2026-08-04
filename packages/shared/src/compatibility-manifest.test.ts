import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CompatibilityManifestPayloadSchema,
  RELEASE_MANIFEST_SIGNATURE_DOMAIN,
  SignedCompatibilityEnvelopeSchema,
  decodeManifestPayload,
  encodeManifestPayload,
  parseCompatibilityManifestPayload,
  parseSignedCompatibilityEnvelope,
  signatureMessageBytes,
  buildSignatureMessage,
} from "./compatibility-manifest.js";
import type { CompatibilityManifestPayload } from "./compatibility-manifest.js";
import { resolvePair } from "./compatibility-resolver.js";

const SHA =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function sampleArtifact(
  overrides: Partial<CompatibilityManifestPayload["channels"]["stable"]["desk"][number]> & {
    artifactId: string;
    kind: "desk" | "grok";
    version: string;
  },
) {
  return {
    artifactId: overrides.artifactId,
    kind: overrides.kind,
    version: overrides.version,
    target: overrides.target ?? "darwin-arm64",
    channel: overrides.channel ?? "stable",
    grantEndpoint: overrides.grantEndpoint ?? "/v1/download-grants",
    sizeBytes: overrides.sizeBytes ?? 1024,
    sha256: overrides.sha256 ?? SHA,
    provenance: overrides.provenance ?? {
      source: "official",
      retrievedAt: "2026-07-01T00:00:00.000Z",
    },
    signingPolicy: overrides.signingPolicy ?? {
      requirePlatformSignature: true,
      macTeamId: "TEAM123",
    },
    capabilities: overrides.capabilities ?? ["agent", "managed-no-self-update"],
  };
}

export function sampleManifest(
  overrides: Partial<CompatibilityManifestPayload> = {},
): CompatibilityManifestPayload {
  const desk = sampleArtifact({
    artifactId: "desk-1.2.0-darwin-arm64",
    kind: "desk",
    version: "1.2.0",
  });
  const grok = sampleArtifact({
    artifactId: "grok-0.9.4-darwin-arm64",
    kind: "grok",
    version: "0.9.4",
  });
  const base: CompatibilityManifestPayload = {
    schemaVersion: 1,
    sequence: 42,
    issuedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-08-01T00:00:00.000Z",
    publishedTargets: ["darwin-arm64", "darwin-x64", "win32-x64"],
    channels: {
      stable: {
        desk: [desk],
        grok: [grok],
        pairs: [
          {
            pairId: "stable-darwin-arm64-1.2.0-0.9.4",
            channel: "stable",
            target: "darwin-arm64",
            deskVersion: "1.2.0",
            grokVersion: "0.9.4",
            deskArtifactId: desk.artifactId,
            grokArtifactId: grok.artifactId,
            capabilities: ["agent", "managed-no-self-update"],
            recommended: true,
          },
        ],
      },
    },
    rollout: {
      basisPoints: 10000,
      salt: "test-rollout-salt",
    },
    securityDeadline: null,
    revocations: [],
    authorizedDowngradeEdges: [],
    releaseNotesUrl: "https://example.com/notes",
    supportUrl: "https://example.com/support",
  };
  return { ...base, ...overrides, channels: overrides.channels ?? base.channels };
}

describe("compatibility-manifest envelope", () => {
  it("uses schemaVersion 1 and Ed25519 signatures over domain-separated payload", () => {
    const payload = sampleManifest();
    const payloadBase64Url = encodeManifestPayload(payload);
    const envelope = parseSignedCompatibilityEnvelope({
      schemaVersion: 1,
      payloadBase64Url,
      signatures: [
        {
          algorithm: "Ed25519",
          keyId: "release-test-1",
          signatureBase64Url: "AAAA",
        },
      ],
    });
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.payloadBase64Url).toBe(payloadBase64Url);
    expect(buildSignatureMessage(payloadBase64Url)).toBe(
      `${RELEASE_MANIFEST_SIGNATURE_DOMAIN}\n${payloadBase64Url}`,
    );
    const bytes = signatureMessageBytes(payloadBase64Url);
    expect(new TextDecoder().decode(bytes)).toBe(
      `${RELEASE_MANIFEST_SIGNATURE_DOMAIN}\n${payloadBase64Url}`,
    );
  });

  it("round-trips payload encoding and decoding", () => {
    const payload = sampleManifest();
    const encoded = encodeManifestPayload(payload);
    const decoded = decodeManifestPayload(encoded);
    expect(decoded).toEqual(payload);
    expect(parseCompatibilityManifestPayload(decoded).sequence).toBe(42);
  });

  it("rejects invalid envelopes and payloads", () => {
    expect(() =>
      parseSignedCompatibilityEnvelope({
        schemaVersion: 2,
        payloadBase64Url: "e30",
        signatures: [],
      }),
    ).toThrow();
    expect(() =>
      parseCompatibilityManifestPayload({
        schemaVersion: 1,
        sequence: -1,
      }),
    ).toThrow();
    expect(() => CompatibilityManifestPayloadSchema.parse({})).toThrow();
    expect(() => SignedCompatibilityEnvelopeSchema.parse({})).toThrow();
  });

  it("requires exact compatibility pairs and artifact metadata", () => {
    const payload = sampleManifest();
    const pair = payload.channels.stable.pairs[0]!;
    expect(pair.deskVersion).toBe("1.2.0");
    expect(pair.grokVersion).toBe("0.9.4");
    expect(pair.deskArtifactId).toBeTruthy();
    expect(pair.grokArtifactId).toBeTruthy();
    const desk = payload.channels.stable.desk[0]!;
    expect(desk.sha256).toMatch(/^[a-f0-9]{64}$/i);
    expect(desk.sizeBytes).toBeGreaterThan(0);
    expect(desk.grantEndpoint).toBeTruthy();
    expect(desk.provenance.source).toBeTruthy();
    expect(desk.signingPolicy.requirePlatformSignature).toBe(true);
  });

  it("matches checked-in JSON Schema and vector fixtures", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const schemaPath = path.resolve(
      here,
      "../../../docs/contracts/release-manifest-v1.schema.json",
    );
    const vectorsPath = path.resolve(
      here,
      "../../../docs/contracts/release-manifest-v1-vectors.json",
    );
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      $id?: string;
      title?: string;
    };
    const vectors = JSON.parse(readFileSync(vectorsPath, "utf8")) as {
      schemaVersion: number;
      signatureDomain: string;
      cases: Array<{
        name: string;
        payload: unknown;
        expect?: {
          resolveStableFrom1_1?: { deskVersion: string; grokVersion: string };
          win32Arm64ResolvesNull?: boolean;
        };
      }>;
    };
    expect(schema.title).toMatch(/release manifest/i);
    expect(vectors.schemaVersion).toBe(1);
    expect(vectors.signatureDomain).toBe(RELEASE_MANIFEST_SIGNATURE_DOMAIN);
    expect(vectors.cases.length).toBeGreaterThan(0);

    let sawStableResolve = false;
    let sawNullResolve = false;

    for (const c of vectors.cases) {
      const payload = parseCompatibilityManifestPayload(c.payload);
      const exp = c.expect;
      if (!exp) continue;

      if (exp.resolveStableFrom1_1) {
        sawStableResolve = true;
        expect(
          resolvePair(payload, {
            target: "darwin-arm64",
            channel: "stable",
            installedDeskVersion: "1.1.0",
            installedGrokVersion: "0.9.0",
            deviceCohortId: "vector-device",
            now: Date.parse("2026-07-10T00:00:00.000Z"),
          }),
        ).toMatchObject(exp.resolveStableFrom1_1);
      }

      if (exp.win32Arm64ResolvesNull) {
        sawNullResolve = true;
        expect(
          resolvePair(payload, {
            target: "win32-arm64",
            channel: "stable",
            installedDeskVersion: "1.1.0",
            installedGrokVersion: "0.9.0",
            deviceCohortId: "vector-device",
            now: Date.parse("2026-07-10T00:00:00.000Z"),
          }),
        ).toBeNull();
      }
    }

    // Vectors must document at least one stable upgrade resolve and one null resolve.
    expect(sawStableResolve).toBe(true);
    expect(sawNullResolve).toBe(true);
  });
});
