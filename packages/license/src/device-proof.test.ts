import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTIVATE_PREFIX,
  LEASE_REFRESH_PREFIX,
  buildProofSigningMaterial,
  verifyActivationProof,
  verifyLeaseRefreshProof,
  type ActivationProofPayload,
  type DevicePublicJwk,
  type LeaseRefreshProofPayload,
} from "./device-proof.js";
import type { PublicJwk } from "./key-ring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(__dirname, "../testdata/crypto/v1");

async function loadVector<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(vectorsDir, name), "utf8")) as T;
}

describe("crypto vectors: activation challenges", () => {
  it("covers valid, tampered, expired, replayed, wrong-device, and refresh cases", async () => {
    const doc = await loadVector<{
      fixedClock: string;
      keys: { device: { publicJwk: PublicJwk } };
      cases: Array<{
        name: string;
        type: string;
        kind: "activation" | "refresh";
        input: {
          payload: ActivationProofPayload | LeaseRefreshProofPayload;
          signatureBase64Url: string;
        };
        expectedCanonicalHex?: string;
        expectedSigningBytesHex?: string;
        options?: {
          challengeExpiresAtMs?: number;
          challengeConsumed?: boolean;
          clientTimeMs?: number;
          maxClockSkewMs?: number;
          nowMs?: number;
        };
        expected: { result: "accept" } | { result: "reject"; code: string };
      }>;
    }>("activation-challenges.json");

    const fixedMs = Date.parse(doc.fixedClock);
    const types = new Set(doc.cases.map((c) => c.type));
    for (const required of [
      "valid",
      "tampered",
      "expired",
      "replayed",
      "wrong_device",
    ]) {
      expect(types.has(required), required).toBe(true);
    }

    const validActivation = doc.cases.find((c) => c.name === "valid_activation");
    expect(validActivation).toBeDefined();
    const actMaterial = buildProofSigningMaterial(
      ACTIVATE_PREFIX,
      validActivation!.input.payload,
    );
    expect(actMaterial.payloadCanonicalHex).toBe(
      validActivation!.expectedCanonicalHex,
    );
    expect(actMaterial.signingBytesHex).toBe(
      validActivation!.expectedSigningBytesHex,
    );

    const validRefresh = doc.cases.find((c) => c.name === "valid_refresh");
    expect(validRefresh).toBeDefined();
    const refMaterial = buildProofSigningMaterial(
      LEASE_REFRESH_PREFIX,
      validRefresh!.input.payload,
    );
    expect(refMaterial.payloadCanonicalHex).toBe(
      validRefresh!.expectedCanonicalHex,
    );

    const deviceJwk: DevicePublicJwk = {
      kty: "OKP",
      crv: "Ed25519",
      x: doc.keys.device.publicJwk.x,
    };

    for (const c of doc.cases) {
      const nowMs = c.options?.nowMs ?? fixedMs;
      const result =
        c.kind === "activation"
          ? verifyActivationProof({
              payload: c.input.payload as ActivationProofPayload,
              signatureBase64Url: c.input.signatureBase64Url,
              challengeExpiresAtMs:
                c.options?.challengeExpiresAtMs ?? fixedMs + 60_000,
              challengeConsumed: c.options?.challengeConsumed,
              nowMs,
              clientTimeMs: c.options?.clientTimeMs,
              maxClockSkewMs: c.options?.maxClockSkewMs,
            })
          : verifyLeaseRefreshProof({
              payload: c.input.payload as LeaseRefreshProofPayload,
              signatureBase64Url: c.input.signatureBase64Url,
              registeredDevicePublicJwk: deviceJwk,
              challengeExpiresAtMs:
                c.options?.challengeExpiresAtMs ?? fixedMs + 60_000,
              challengeConsumed: c.options?.challengeConsumed,
              nowMs,
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
