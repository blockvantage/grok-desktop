import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  STABLE_ERROR_CODES,
  stableErrorCodes,
  isStableErrorCode,
} from "./errors.js";
import {
  CANONICAL_TARGETS,
  isCanonicalTarget,
} from "./targets.js";
import {
  DESKTOP_LICENSE_STATES,
  ENTITLEMENT_STATES,
  GROK_OPERATION_ALLOWED_STATES,
} from "./states.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.join(__dirname, "testdata/crypto/v1");

const VECTOR_FILES = [
  "product-keys.json",
  "activation-challenges.json",
  "device-leases.json",
  "release-manifests.json",
] as const;

/** Expected SHA-256 of landing OpenAPI entitlement-api.v1.json snapshot. */
const OPENAPI_SHA256_PATH = path.join(__dirname, "openapi-v1.sha256");

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(vectorsDir, name), "utf8"));
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

describe("entitlement stable error codes", () => {
  it("exports the frozen stable error code set", () => {
    expect(STABLE_ERROR_CODES).toHaveLength(24);
    expect(stableErrorCodes).toEqual(STABLE_ERROR_CODES);
    expect(new Set(STABLE_ERROR_CODES).size).toBe(24);
  });

  it("includes Contract Gate C1 codes and legacy GD2 exchange codes", () => {
    for (const code of [
      "invalid_key_format",
      "invalid_key_signature",
      "key_rotated",
      "seat_limit",
      "challenge_expired",
      "challenge_replayed",
      "device_signature_invalid",
      "lease_expired",
      "lease_device_mismatch",
      "legacy_key_unsupported",
      "legacy_key_not_allowlisted",
      "legacy_exchange_closed",
      "service_unavailable",
    ] as const) {
      expect(isStableErrorCode(code)).toBe(true);
    }
    expect(isStableErrorCode("not_a_real_code")).toBe(false);
  });
});

describe("entitlement states and targets", () => {
  it("exports server entitlement states", () => {
    expect(ENTITLEMENT_STATES).toContain("active");
    expect(ENTITLEMENT_STATES).toContain("revoked");
    expect(ENTITLEMENT_STATES).toHaveLength(6);
  });

  it("exports desktop license states including recovery modes", () => {
    expect(DESKTOP_LICENSE_STATES).toContain("unactivated");
    expect(DESKTOP_LICENSE_STATES).toContain("offline_grace");
    expect(DESKTOP_LICENSE_STATES).toContain("migration_required");
    expect(GROK_OPERATION_ALLOWED_STATES).toEqual([
      "active",
      "refresh_due",
      "offline_grace",
    ]);
  });

  it("exports four canonical targets", () => {
    expect(CANONICAL_TARGETS).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "win32-x64",
      "win32-arm64",
    ]);
    expect(isCanonicalTarget("darwin-arm64")).toBe(true);
    expect(isCanonicalTarget("linux-x64")).toBe(false);
  });
});

describe("commerce crypto vectors (fixtures)", () => {
  it("ships all four v1 vector files", () => {
    for (const name of VECTOR_FILES) {
      const p = path.join(vectorsDir, name);
      expect(existsSync(p), name).toBe(true);
      expect(sha256File(p)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("product-keys cases cover accept and reject paths", () => {
    const doc = loadJson("product-keys.json") as {
      cases: Array<{ name: string; type: string; expected: { result: string; code?: string } }>;
    };
    const types = new Set(doc.cases.map((c) => c.type));
    expect(types.has("valid")).toBe(true);
    expect(types.has("tampered")).toBe(true);
    expect(doc.cases.some((c) => c.expected.result === "accept")).toBe(true);
    expect(doc.cases.some((c) => c.expected.result === "reject")).toBe(true);
    for (const c of doc.cases) {
      if (c.expected.result === "reject" && c.expected.code) {
        // Codes used in vectors must be stable or known crypto-local codes.
        expect(
          isStableErrorCode(c.expected.code) ||
            c.expected.code === "unknown_key",
        ).toBe(true);
      }
    }
  });

  it("activation-challenges cover required adversarial types", () => {
    const doc = loadJson("activation-challenges.json") as {
      cases: Array<{ type: string; kind: string }>;
    };
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
    expect(doc.cases.some((c) => c.kind === "activation")).toBe(true);
    expect(doc.cases.some((c) => c.kind === "refresh")).toBe(true);
  });

  it("device-leases cover valid/tampered/expired/wrong_device", () => {
    const doc = loadJson("device-leases.json") as {
      header: { alg: string; typ: string };
      cases: Array<{ type: string }>;
    };
    expect(doc.header).toMatchObject({
      alg: "EdDSA",
      typ: "grokdesk-lease+jwt",
    });
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
  });

  it("release-manifests cover sequence rollback", () => {
    const doc = loadJson("release-manifests.json") as {
      cases: Array<{ type: string }>;
    };
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
  });

  it("pins OpenAPI v1 snapshot SHA-256", () => {
    expect(existsSync(OPENAPI_SHA256_PATH)).toBe(true);
    const pinned = readFileSync(OPENAPI_SHA256_PATH, "utf8").trim();
    expect(pinned).toMatch(/^[0-9a-f]{64}$/);
    // Must match packages/entitlement-client OPENAPI_SHA256 / landing openapi file.
    expect(pinned).toBe(
      "c14445afe743dff10eacded303f224ce91f87f6afa6031d5c3d10aeca515137d",
    );
  });
});
