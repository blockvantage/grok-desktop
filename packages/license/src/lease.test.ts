import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyDeviceLease, verifyLease } from "./lease.js";
import type { PublicJwk } from "./key-ring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(__dirname, "../testdata/crypto/v1");

async function loadVector<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(vectorsDir, name), "utf8")) as T;
}

describe("crypto vectors: device leases", () => {
  it("verifies compact EdDSA leases with mismatch and expiry cases", async () => {
    const doc = await loadVector<{
      fixedClockSeconds: number;
      header: { alg: string; typ: string; kid: string };
      claims: {
        iss: string;
        aud: string;
        deviceThumbprint: string;
      };
      keys: { lease: { publicJwk: PublicJwk } };
      expectedLease: string;
      cases: Array<{
        name: string;
        type: string;
        input: { lease: string };
        options?: { expectedDeviceThumbprint?: string };
        expected: { result: "accept" } | { result: "reject"; code: string };
      }>;
    }>("device-leases.json");

    expect(doc.header).toMatchObject({
      alg: "EdDSA",
      typ: "grokdesk-lease+jwt",
    });
    expect(doc.expectedLease.split(".")).toHaveLength(3);

    const types = new Set(doc.cases.map((c) => c.type));
    for (const required of [
      "valid",
      "tampered",
      "expired",
      "wrong_device",
      "unknown_key",
    ]) {
      expect(types.has(required), required).toBe(true);
    }

    for (const c of doc.cases) {
      const result = await verifyDeviceLease(c.input.lease, {
        publicKey: doc.keys.lease.publicJwk,
        expectedIssuer: doc.claims.iss,
        expectedAudience: doc.claims.aud,
        expectedDeviceThumbprint:
          c.options?.expectedDeviceThumbprint ??
          (c.name === "wrong_device" ? doc.claims.deviceThumbprint : undefined),
        nowSeconds: doc.fixedClockSeconds,
        clockToleranceSeconds: 0,
      });
      if (c.expected.result === "accept") {
        expect(result.ok, c.name).toBe(true);
      } else {
        expect(result.ok, c.name).toBe(false);
        if (!result.ok) expect(result.code).toBe(c.expected.code);
      }
    }
  });

  it("verifyLease alias rejects device mismatch from vectors", async () => {
    const doc = await loadVector<{
      fixedClockSeconds: number;
      claims: { iss: string; aud: string; deviceThumbprint: string };
      keys: { lease: { publicJwk: PublicJwk } };
      cases: Array<{
        name: string;
        input: { lease: string };
        options?: { expectedDeviceThumbprint?: string };
      }>;
    }>("device-leases.json");

    const wrong = doc.cases.find((c) => c.name === "wrong_device");
    expect(wrong).toBeDefined();
    const result = await verifyLease(wrong!.input.lease, {
      publicKey: doc.keys.lease.publicJwk,
      expectedIssuer: doc.claims.iss,
      expectedAudience: doc.claims.aud,
      expectedDeviceThumbprint:
        wrong!.options?.expectedDeviceThumbprint ?? doc.claims.deviceThumbprint,
      nowSeconds: doc.fixedClockSeconds,
      clockToleranceSeconds: 0,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "lease_device_mismatch",
    });
  });
});
