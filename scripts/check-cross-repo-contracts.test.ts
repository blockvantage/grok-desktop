/**
 * Deterministic unit tests for pure cross-repo contract digests.
 *
 * PATH standard: fixtures live in-memory only — never load real bearer
 * material into assertions. Run:
 *   pnpm exec vitest run scripts/check-cross-repo-contracts.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  checkContracts,
  compositeSha256,
  digestsFromMaterials,
  extractStableErrorCodes,
  normalizeLineEndings,
  sha256NormalizedText,
  type ContractSideDigests,
  DESKTOP_CONTRACT_PATHS,
  LANDING_CONTRACT_PATHS,
  CRYPTO_VECTOR_FILES,
  MANIFEST_VECTOR_FILE,
} from "./check-cross-repo-contracts.js";

const ERRORS_A = `
export const STABLE_ERROR_CODES = [
  "invalid_key_format",
  "seat_limit",
  "service_unavailable",
] as const;
`;

const ERRORS_B = `
export const STABLE_ERROR_CODES = [
  "invalid_key_format",
  "legacy_key_unsupported",
  "service_unavailable",
] as const;
`;

const OPENAPI_A = '{\n  "openapi": "3.1.0",\n  "info": { "title": "A" }\n}\n';
const OPENAPI_B = '{\n  "openapi": "3.1.0",\n  "info": { "title": "B" }\n}\n';

function vectorBodies(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of CRYPTO_VECTOR_FILES) {
    out[name] = `{"fixture":"${tag}","file":"${name}"}\n`;
  }
  return out;
}

const fixtureA: ContractSideDigests = digestsFromMaterials({
  openapi: OPENAPI_A,
  errorRegistrySource: ERRORS_A,
  cryptoVectors: vectorBodies("A"),
  manifestVector: `{"fixture":"A","file":"${MANIFEST_VECTOR_FILE}"}\n`,
});

const fixtureB: ContractSideDigests = digestsFromMaterials({
  openapi: OPENAPI_B,
  errorRegistrySource: ERRORS_A, // error registry matches A
  cryptoVectors: vectorBodies("B"),
  manifestVector: `{"fixture":"A","file":"${MANIFEST_VECTOR_FILE}"}\n`, // manifests match A
});

describe("PATH standard contract layout constants", () => {
  it("keeps desktop paths under packages/shared and packages/license", () => {
    expect(DESKTOP_CONTRACT_PATHS.sharedCryptoVectorsDir).toBe(
      "packages/shared/src/entitlements/testdata/crypto/v1",
    );
    expect(DESKTOP_CONTRACT_PATHS.licenseCryptoVectorsDir).toBe(
      "packages/license/testdata/crypto/v1",
    );
    expect(DESKTOP_CONTRACT_PATHS.openapiPin).toBe(
      "packages/shared/src/entitlements/openapi-v1.sha256",
    );
    expect(DESKTOP_CONTRACT_PATHS.errors).toBe(
      "packages/shared/src/entitlements/errors.ts",
    );
  });

  it("keeps landing paths under entitlement-api contracts/", () => {
    expect(LANDING_CONTRACT_PATHS.cryptoVectorsDir).toBe("contracts/crypto/v1");
    expect(LANDING_CONTRACT_PATHS.openapi).toBe(
      "openapi/entitlement-api.v1.json",
    );
    expect(LANDING_CONTRACT_PATHS.errors).toBe("src/errors.ts");
  });
});

describe("normalizeLineEndings / digests", () => {
  it("normalizes CRLF and CR only", () => {
    expect(normalizeLineEndings("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });

  it("produces identical digests for CRLF vs LF content", () => {
    const lf = sha256NormalizedText('{"ok":true}\n');
    const crlf = sha256NormalizedText('{"ok":true}\r\n');
    expect(lf).toBe(crlf);
    expect(lf).toMatch(/^[0-9a-f]{64}$/);
  });

  it("composite digest is order-independent", () => {
    const a = compositeSha256([
      { name: "b.json", sha256: "11" },
      { name: "a.json", sha256: "22" },
    ]);
    const b = compositeSha256([
      { name: "a.json", sha256: "22" },
      { name: "b.json", sha256: "11" },
    ]);
    expect(a).toBe(b);
  });
});

describe("extractStableErrorCodes", () => {
  it("parses quoted codes in declaration order", () => {
    expect(extractStableErrorCodes(ERRORS_A)).toEqual([
      "invalid_key_format",
      "seat_limit",
      "service_unavailable",
    ]);
  });
});

describe("checkContracts", () => {
  it("accepts identical fixture digests", () => {
    expect(checkContracts({ landing: fixtureA, desktop: fixtureA })).toEqual({
      ok: true,
      differences: [],
    });
  });

  it("reports openapi and crypto vector drift for fixtureA vs fixtureB", () => {
    expect(checkContracts({ landing: fixtureA, desktop: fixtureB })).toEqual({
      ok: false,
      differences: ["openapiSha256", "cryptoVectorsSha256"],
    });
  });

  it("reports error registry drift when codes differ", () => {
    const drifted = digestsFromMaterials({
      openapi: OPENAPI_A,
      errorRegistrySource: ERRORS_B,
      cryptoVectors: vectorBodies("A"),
      manifestVector: `{"fixture":"A","file":"${MANIFEST_VECTOR_FILE}"}\n`,
    });
    expect(checkContracts({ landing: fixtureA, desktop: drifted })).toEqual({
      ok: false,
      differences: ["errorRegistrySha256"],
    });
  });

  it("reports manifest vector drift independently", () => {
    const drifted = digestsFromMaterials({
      openapi: OPENAPI_A,
      errorRegistrySource: ERRORS_A,
      cryptoVectors: vectorBodies("A"),
      manifestVector: `{"fixture":"B","file":"${MANIFEST_VECTOR_FILE}"}\n`,
    });
    expect(checkContracts({ landing: fixtureA, desktop: drifted })).toEqual({
      ok: false,
      differences: ["manifestVectorsSha256"],
    });
  });

  it("accepts openapi pin hex as the openapi digest", () => {
    const pin = sha256NormalizedText(OPENAPI_A);
    const fromPin = digestsFromMaterials({
      openapi: pin,
      errorRegistrySource: ERRORS_A,
      cryptoVectors: vectorBodies("A"),
      manifestVector: `{"fixture":"A","file":"${MANIFEST_VECTOR_FILE}"}\n`,
    });
    expect(fromPin.openapiSha256).toBe(fixtureA.openapiSha256);
    expect(checkContracts({ landing: fixtureA, desktop: fromPin }).ok).toBe(
      true,
    );
  });
});
