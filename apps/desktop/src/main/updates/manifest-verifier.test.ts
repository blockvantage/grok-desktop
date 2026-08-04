import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encodeManifestPayload,
  type SignedCompatibilityEnvelope,
} from "@grokdesk/shared";
import {
  getBuiltInReleasePublicKeys,
  hashManifestPayload,
  parseReleasePublicKeys,
  verifySignedCompatibilityManifest,
} from "./manifest-verifier.js";
import {
  generateTestKey,
  keyRing,
  samplePayload,
  signEnvelope,
} from "./manifest-test-helpers.js";

const FIXED_NOW = Date.parse("2026-07-10T12:00:00.000Z");

describe("manifest-verifier", () => {
  const primary = generateTestKey("release-1");
  const rotated = generateTestKey("release-2");
  const unknown = generateTestKey("release-unknown");

  it("accepts a valid signature and returns payload hash/sequence", () => {
    const payload = samplePayload();
    const envelope = signEnvelope(payload, [primary]);
    const result = verifySignedCompatibilityManifest(envelope, {
      keys: keyRing(primary, rotated),
      nowMs: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.acceptedKeyId).toBe("release-1");
    expect(result.sequence).toBe(42);
    expect(result.payloadSha256).toBe(
      hashManifestPayload(envelope.payloadBase64Url),
    );
    expect(result.payload.channels.stable.pairs[0]?.pairId).toContain("1.2.0");
  });

  it("accepts overlapping key rotation (either trusted key)", () => {
    const payload = samplePayload({ sequence: 50 });
    const ring = keyRing(primary, rotated);

    const byPrimary = verifySignedCompatibilityManifest(
      signEnvelope(payload, [primary]),
      { keys: ring, nowMs: FIXED_NOW },
    );
    expect(byPrimary.ok).toBe(true);
    if (byPrimary.ok) expect(byPrimary.acceptedKeyId).toBe("release-1");

    const byRotated = verifySignedCompatibilityManifest(
      signEnvelope(payload, [rotated]),
      { keys: ring, nowMs: FIXED_NOW },
    );
    expect(byRotated.ok).toBe(true);
    if (byRotated.ok) expect(byRotated.acceptedKeyId).toBe("release-2");

    const both = verifySignedCompatibilityManifest(
      signEnvelope(payload, [rotated, primary]),
      { keys: ring, nowMs: FIXED_NOW },
    );
    expect(both.ok).toBe(true);
  });

  it("rejects unknown-only signatures", () => {
    const envelope = signEnvelope(samplePayload(), [unknown]);
    const result = verifySignedCompatibilityManifest(envelope, {
      keys: keyRing(primary, rotated),
      nowMs: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unknown_key");
  });

  it("rejects tampered payload", () => {
    const envelope = signEnvelope(samplePayload(), [primary]);
    const tampered: SignedCompatibilityEnvelope = {
      ...envelope,
      payloadBase64Url:
        envelope.payloadBase64Url.slice(0, 10) +
        (envelope.payloadBase64Url[10] === "A" ? "B" : "A") +
        envelope.payloadBase64Url.slice(11),
    };
    const result = verifySignedCompatibilityManifest(tampered, {
      keys: keyRing(primary),
      nowMs: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["invalid_payload", "invalid_signature"]).toContain(result.code);
    }
  });

  it("rejects expired manifests", () => {
    const envelope = signEnvelope(
      samplePayload({ expiresAt: "2026-07-01T00:00:00.000Z" }),
      [primary],
    );
    const result = verifySignedCompatibilityManifest(envelope, {
      keys: keyRing(primary),
      nowMs: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("manifest_expired");
  });

  it("accepts highest sequence advancement and same sequence/same hash", () => {
    const payload = samplePayload({ sequence: 100 });
    const envelope = signEnvelope(payload, [primary]);
    const first = verifySignedCompatibilityManifest(envelope, {
      keys: keyRing(primary),
      nowMs: FIXED_NOW,
      highestSequenceSeen: 42,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = verifySignedCompatibilityManifest(envelope, {
      keys: keyRing(primary),
      nowMs: FIXED_NOW,
      highestSequenceSeen: first.sequence,
      highestSequencePayloadSha256: first.payloadSha256,
    });
    expect(again.ok).toBe(true);
  });

  it("rejects same sequence with different hash", () => {
    const a = signEnvelope(
      samplePayload({ sequence: 10, supportUrl: "https://a.example/s" }),
      [primary],
    );
    const b = signEnvelope(
      samplePayload({ sequence: 10, supportUrl: "https://b.example/s" }),
      [primary],
    );
    const first = verifySignedCompatibilityManifest(a, {
      keys: keyRing(primary),
      nowMs: FIXED_NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = verifySignedCompatibilityManifest(b, {
      keys: keyRing(primary),
      nowMs: FIXED_NOW,
      highestSequenceSeen: first.sequence,
      highestSequencePayloadSha256: first.payloadSha256,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("sequence_hash_mismatch");
  });

  it("rejects sequence rollback", () => {
    const envelope = signEnvelope(samplePayload({ sequence: 5 }), [primary]);
    const result = verifySignedCompatibilityManifest(envelope, {
      keys: keyRing(primary),
      nowMs: FIXED_NOW,
      highestSequenceSeen: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("sequence_rollback");
  });

  it("rejects absent target", () => {
    const envelope = signEnvelope(
      samplePayload({
        publishedTargets: ["darwin-x64", "win32-x64"],
      }),
      [primary],
    );
    const result = verifySignedCompatibilityManifest(envelope, {
      keys: keyRing(primary),
      nowMs: FIXED_NOW,
      requiredTarget: "darwin-arm64",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("absent_target");
  });

  it("rejects revoked pair when required", () => {
    const pairId = "stable-darwin-arm64-1.2.0-0.9.4";
    const envelope = signEnvelope(
      samplePayload({
        revocations: [
          {
            kind: "pair",
            id: pairId,
            reason: "security",
            revokedAt: "2026-07-05T00:00:00.000Z",
          },
        ],
      }),
      [primary],
    );
    const result = verifySignedCompatibilityManifest(envelope, {
      keys: keyRing(primary),
      nowMs: FIXED_NOW,
      requiredPairId: pairId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("revoked_pair");
  });

  it("parseReleasePublicKeys loads a JSON JWK ring", () => {
    const json = JSON.stringify([primary.publicJwk, rotated.publicJwk]);
    const ring = parseReleasePublicKeys(json);
    expect(ring.size).toBe(2);
    expect(ring.get("release-1")?.x).toBe(primary.publicJwk.x);
  });

  it("getBuiltInReleasePublicKeys is empty without env/define", () => {
    const prev = process.env.GROKDESK_RELEASE_PUBLIC_KEYS;
    delete process.env.GROKDESK_RELEASE_PUBLIC_KEYS;
    try {
      expect(getBuiltInReleasePublicKeys().size).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.GROKDESK_RELEASE_PUBLIC_KEYS;
      else process.env.GROKDESK_RELEASE_PUBLIC_KEYS = prev;
    }
  });

  it("ignores ambient release keys for packaged/default trust-root lookup", () => {
    const env = {
      GROKDESK_RELEASE_PUBLIC_KEYS: JSON.stringify([primary.publicJwk]),
    };
    expect(getBuiltInReleasePublicKeys({ env, isPackaged: true }).size).toBe(0);
    expect(getBuiltInReleasePublicKeys({ env }).size).toBe(0);
  });

  it("accepts ambient release keys only through explicit unpackaged dev injection", () => {
    const env = {
      GROKDESK_RELEASE_PUBLIC_KEYS: JSON.stringify([primary.publicJwk]),
    };
    const ring = getBuiltInReleasePublicKeys({
      env,
      isPackaged: false,
      allowDevEnvOverride: true,
    });
    expect(ring.get(primary.kid)?.x).toBe(primary.publicJwk.x);
  });

  it("rejects invalid known-key signatures", () => {
    const envelope = signEnvelope(samplePayload(), [primary]);
    const bad: SignedCompatibilityEnvelope = {
      ...envelope,
      signatures: [
        {
          algorithm: "Ed25519",
          keyId: primary.kid,
          signatureBase64Url: Buffer.alloc(64, 7).toString("base64url"),
        },
      ],
    };
    const result = verifySignedCompatibilityManifest(bad, {
      keys: keyRing(primary),
      nowMs: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_signature");
  });

  it("accepts PEM public keys in the ring", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const payload = samplePayload({ sequence: 7 });
    const payloadBase64Url = encodeManifestPayload(payload);
    const signingString = `GROKDESK-RELEASE-MANIFEST-V1\n${payloadBase64Url}`;
    const sig = cryptoSign(
      null,
      Buffer.from(signingString, "utf8"),
      privateKey,
    );
    const envelope: SignedCompatibilityEnvelope = {
      schemaVersion: 1,
      payloadBase64Url,
      signatures: [
        {
          algorithm: "Ed25519",
          keyId: "pem-key",
          signatureBase64Url: Buffer.from(sig).toString("base64url"),
        },
      ],
    };
    const result = verifySignedCompatibilityManifest(envelope, {
      keys: new Map([["pem-key", pem]]),
      nowMs: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.acceptedKeyId).toBe("pem-key");
  });
});
