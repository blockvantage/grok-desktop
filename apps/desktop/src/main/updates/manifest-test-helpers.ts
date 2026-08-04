/**
 * Shared test fixtures for signed compatibility manifests (not production code).
 */
import {
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import {
  encodeManifestPayload,
  type CompatibilityManifestPayload,
  type SignedCompatibilityEnvelope,
} from "@grokdesk/shared";
import type { PublicJwk } from "@grokdesk/license";

const SHA =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function sampleArtifact(
  overrides: Partial<
    CompatibilityManifestPayload["channels"]["stable"]["desk"][number]
  > & {
    artifactId: string;
    kind: "desk" | "grok";
    version: string;
  },
) {
  return {
    artifactId: overrides.artifactId,
    kind: overrides.kind,
    version: overrides.version,
    target: overrides.target ?? ("darwin-arm64" as const),
    channel: overrides.channel ?? ("stable" as const),
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

export function samplePayload(
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
    rollout: { basisPoints: 10000, salt: "test-rollout-salt" },
    securityDeadline: null,
    revocations: [],
    authorizedDowngradeEdges: [],
    releaseNotesUrl: "https://example.com/notes",
    supportUrl: "https://example.com/support",
  };
  return {
    ...base,
    ...overrides,
    channels: overrides.channels ?? base.channels,
  };
}

export type TestKey = {
  kid: string;
  privateKey: KeyObject;
  publicJwk: PublicJwk;
};

export function generateTestKey(kid: string): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as {
    kty: string;
    crv: string;
    x: string;
  };
  return {
    kid,
    privateKey,
    publicJwk: {
      kty: "OKP",
      crv: "Ed25519",
      x: jwk.x,
      kid,
      alg: "EdDSA",
    },
  };
}

export function signEnvelope(
  payload: CompatibilityManifestPayload,
  keys: TestKey[],
): SignedCompatibilityEnvelope {
  const payloadBase64Url = encodeManifestPayload(payload);
  const signingString = `GROKDESK-RELEASE-MANIFEST-V1\n${payloadBase64Url}`;
  const signatures = keys.map((k) => {
    const sig = cryptoSign(null, Buffer.from(signingString, "utf8"), k.privateKey);
    return {
      algorithm: "Ed25519" as const,
      keyId: k.kid,
      signatureBase64Url: Buffer.from(sig).toString("base64url"),
    };
  });
  return {
    schemaVersion: 1,
    payloadBase64Url,
    signatures,
  };
}

export function keyRing(...keys: TestKey[]): Map<string, PublicJwk> {
  return new Map(keys.map((k) => [k.kid, k.publicJwk]));
}
