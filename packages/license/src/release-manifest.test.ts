import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildManifestSigningMaterial,
  verifyReleaseManifest,
  type ReleaseManifestPayload,
  type SignedReleaseManifestEnvelope,
} from "./release-manifest.js";
import type { PublicJwk } from "./key-ring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(__dirname, "../testdata/crypto/v1");

async function loadVector<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(vectorsDir, name), "utf8")) as T;
}

describe("crypto vectors: release manifests", () => {
  it("verifies signed manifests including sequence rollback", async () => {
    const doc = await loadVector<{
      fixedClock: string;
      keys: {
        release: { kid: string; publicJwk: PublicJwk };
        releaseRotated: { kid: string; publicJwk: PublicJwk };
      };
      payload: ReleaseManifestPayload;
      envelope: SignedReleaseManifestEnvelope;
      cases: Array<{
        name: string;
        type: string;
        input: { envelope: SignedReleaseManifestEnvelope };
        expectedCanonicalHex?: string;
        expectedSigningBytesHex?: string;
        options?: { highestSequenceSeen?: number };
        expected: { result: "accept" } | { result: "reject"; code: string };
      }>;
    }>("release-manifests.json");

    const material = buildManifestSigningMaterial(doc.payload);
    const valid = doc.cases.find((c) => c.name === "valid");
    expect(material.payloadCanonicalHex).toBe(valid!.expectedCanonicalHex);
    expect(material.signingBytesHex).toBe(valid!.expectedSigningBytesHex);

    const types = new Set(doc.cases.map((c) => c.type));
    for (const required of [
      "valid",
      "tampered",
      "expired",
      "sequence_rollback",
      "unknown_key",
    ]) {
      expect(types.has(required), required).toBe(true);
    }

    const keys = new Map([
      [doc.keys.release.kid, doc.keys.release.publicJwk],
      [doc.keys.releaseRotated.kid, doc.keys.releaseRotated.publicJwk],
    ]);
    const nowMs = Date.parse(doc.fixedClock);

    for (const c of doc.cases) {
      const result = verifyReleaseManifest(c.input.envelope, {
        keys,
        nowMs,
        highestSequenceSeen: c.options?.highestSequenceSeen,
      });
      if (c.expected.result === "accept") {
        expect(result.ok, c.name).toBe(true);
      } else {
        expect(result.ok, c.name).toBe(false);
        if (!result.ok) expect(result.code).toBe(c.expected.code);
      }
    }
  });
});
