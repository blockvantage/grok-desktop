import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractGd3,
  productKeySigningInput,
  verifyProductKey,
  type ProductKeyClaims,
} from "./product-key.js";
import type { PublicJwk } from "./key-ring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(__dirname, "../testdata/crypto/v1");

async function loadVector<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(vectorsDir, name), "utf8")) as T;
}

describe("extractGd3", () => {
  it("extracts a single GD3 token from free-form paste", () => {
    expect(extractGd3("Here is your key:\n GD3.abc.def \nThanks")).toBe(
      "GD3.abc.def",
    );
  });

  it("rejects multiple keys", () => {
    expect(() => extractGd3("GD3.a.b and GD3.c.d")).toThrowError("multiple_keys");
  });

  it("rejects empty, oversized, and legacy schemes", () => {
    expect(() => extractGd3("")).toThrowError("invalid_key_format");
    expect(() => extractGd3("no key here")).toThrowError("invalid_key_format");
    expect(() => extractGd3("x".repeat(9000))).toThrowError("invalid_key_format");
    expect(() => extractGd3("GD1.abc.def")).toThrowError("invalid_key_format");
    expect(() => extractGd3("GD2.abc.def")).toThrowError("invalid_key_format");
  });
});

describe("crypto vectors: product keys", () => {
  it("matches fixed GD3 signing bytes and case outcomes", async () => {
    const doc = await loadVector<{
      fixedClock: string;
      keys: {
        product: { kid: string; publicJwk: PublicJwk };
        productRotated: { kid: string; publicJwk: PublicJwk };
      };
      claimsTemplate: ProductKeyClaims;
      cases: Array<{
        name: string;
        type: string;
        input: { gd3: string };
        expectedCanonicalHex?: string;
        expectedSigningBytesHex?: string;
        expectedSignatureBase64Url?: string;
        expectedGd3?: string;
        options?: {
          currentKeyVersionByEntitlement?: Record<string, number>;
        };
        expected: { result: "accept" } | { result: "reject"; code: string };
      }>;
    }>("product-keys.json");

    const material = productKeySigningInput(doc.claimsTemplate);
    const valid = doc.cases.find((c) => c.name === "valid");
    expect(valid).toBeDefined();
    expect(material.claimsCanonicalHex).toBe(valid!.expectedCanonicalHex);
    expect(material.signingBytesHex).toBe(valid!.expectedSigningBytesHex);
    expect(valid!.expectedGd3).toMatch(/^GD3\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const keys = new Map([
      [doc.keys.product.kid, doc.keys.product.publicJwk],
      [doc.keys.productRotated.kid, doc.keys.productRotated.publicJwk],
    ]);

    for (const c of doc.cases) {
      const current = c.options?.currentKeyVersionByEntitlement;
      const result = verifyProductKey(c.input.gd3, {
        keys,
        currentKeyVersionByEntitlement: current
          ? new Map(Object.entries(current))
          : undefined,
      });
      if (c.expected.result === "accept") {
        expect(result.ok, c.name).toBe(true);
      } else {
        expect(result.ok, c.name).toBe(false);
        if (!result.ok) expect(result.code).toBe(c.expected.code);
      }
    }
  });

  it("rejects GD1 and GD2 schemes", () => {
    const keys = new Map<string, PublicJwk>();
    expect(verifyProductKey("GD1.abc.def", { keys }).ok).toBe(false);
    expect(verifyProductKey("GD2.abc.def", { keys }).ok).toBe(false);
  });
});
