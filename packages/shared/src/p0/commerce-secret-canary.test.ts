/**
 * Shared commerce secret-canary suite (Task 12).
 *
 * Asserts centralized redaction strips GD1/GD2/GD3, lease JWTs, private
 * JWK/PKCS#8, activation/refresh signatures, challenge nonces, and
 * portal/magic/grant tokens from free-form and structured surfaces.
 */
import { describe, expect, it } from "vitest";
import {
  COMMERCE_CANARY_FIXTURES,
  allCommerceCanaryValues,
  assertNoCommerceCanaries,
  containsLiteralSecret,
  findCommerceCanaries,
  formatSafeEntitlementLog,
  redactCommerceSecrets,
  redactCommerceValue,
  redactSecretString,
  toSafeEntitlementWireError,
} from "../secret-redact.js";

const F = COMMERCE_CANARY_FIXTURES;

describe("commerce secret canary (shared)", () => {
  it("exports distinct canary fixtures for every commerce secret class", () => {
    const values = allCommerceCanaryValues();
    expect(values.length).toBeGreaterThanOrEqual(12);
    expect(new Set(values).size).toBe(values.length);
    expect(F.gd1.startsWith("GD1.")).toBe(true);
    expect(F.gd2.startsWith("GD2.")).toBe(true);
    expect(F.gd3.startsWith("GD3.")).toBe(true);
    expect(F.leaseJwt.startsWith("eyJ")).toBe(true);
    expect(F.privatePkcs8Base64.startsWith("MC4CAQAwBQYDK2Vw")).toBe(true);
  });

  it("redactCommerceSecrets strips product keys and lease JWTs", () => {
    for (const key of [F.gd1, F.gd2, F.gd3, F.leaseJwt]) {
      const out = redactCommerceSecrets(`msg ${key} tail`);
      expect(containsLiteralSecret(out, key)).toBe(false);
      expect(out).toContain("[REDACTED]");
    }
  });

  it("redactCommerceSecrets strips private PKCS#8 and JWK d", () => {
    expect(
      redactCommerceSecrets(`pk=${F.privatePkcs8Base64}`),
    ).not.toContain(F.privatePkcs8Base64);

    const jwk = JSON.stringify({
      kty: "OKP",
      crv: "Ed25519",
      d: F.privateJwkD,
      x: "public-x",
    });
    const out = redactCommerceSecrets(jwk);
    expect(out).not.toContain(F.privateJwkD);
  });

  it("redactCommerceSecrets strips signature/nonce/token assignment forms", () => {
    const samples = [
      `signature: ${F.activationSignature}`,
      `"signature":"${F.refreshSignature}"`,
      `nonce=${F.challengeNonce}`,
      `"nonce": "${F.challengeNonce}"`,
      `portalToken=${F.portalToken}`,
      `magicToken: ${F.magicToken}`,
      `grant=${F.grantToken}`,
      `"grantToken":"${F.grantToken}"`,
      `https://example/redeem?grant=${F.grantToken}&x=1`,
      `https://portal.example/magic?token=${F.magicToken}`,
    ];
    for (const s of samples) {
      assertNoCommerceCanaries(redactCommerceSecrets(s), s.slice(0, 48));
    }
  });

  it("redactSecretString applies general + commerce patterns", () => {
    const mixed = `Bearer sk-abcdefghijklmnop key=${F.gd3} lease=${F.leaseJwt}`;
    const out = redactSecretString(mixed);
    expect(out).not.toMatch(/sk-abcdefghijklmnop/);
    assertNoCommerceCanaries(out, "redactSecretString mixed");
  });

  it("redactCommerceValue deep-redacts known secret fields", () => {
    const obj = {
      ok: true,
      productKey: F.gd3,
      nested: {
        signature: F.activationSignature,
        nonce: F.challengeNonce,
        grant: F.grantToken,
        safe: "desk-version-1",
      },
      lease: F.leaseJwt,
      freeText: `embed ${F.gd1}`,
    };
    const redacted = redactCommerceValue(obj);
    const text = JSON.stringify(redacted);
    assertNoCommerceCanaries(text, "redactCommerceValue");
    expect(redacted.nested.safe).toBe("desk-version-1");
    expect(redacted.productKey).toBe("[REDACTED]");
    expect(redacted.nested.signature).toBe("[REDACTED]");
  });

  it("formatSafeEntitlementLog emits only allowlisted telemetry fields", () => {
    const line = formatSafeEntitlementLog({
      event: "entitlement.refresh",
      code: "lease_expired",
      platform: "win32",
      architecture: "x64",
      retryClass: "retryable",
      correlationId: "corr-abc",
    });
    expect(line).toBe(
      "event=entitlement.refresh code=lease_expired platform=win32 architecture=x64 retryClass=retryable correlationId=corr-abc",
    );
    // Fetch bodies are never part of the schema — line has fixed keys only.
    expect(line).not.toMatch(/body|payload|responseText|requestBody/i);
  });

  it("toSafeEntitlementWireError carries stable codes only", () => {
    const wire = toSafeEntitlementWireError({
      code: "entitlement_read_only",
      state: "revoked",
      action: "tasks.create",
      capability: "grok_operation",
      denialCode: "entitlement_revoked",
    });
    expect(wire).toEqual({
      code: "entitlement_read_only",
      state: "revoked",
      action: "tasks.create",
      capability: "grok_operation",
      denialCode: "entitlement_revoked",
    });
    assertNoCommerceCanaries(JSON.stringify(wire), "wire error");
  });

  it("findCommerceCanaries / assertNoCommerceCanaries scan surfaces", () => {
    // Opaque grant tokens require field context (as on the wire); product keys
    // match structurally without a field prefix.
    const dirty = `log ${F.gd3} and grant=${F.grantToken}`;
    expect(findCommerceCanaries(dirty).length).toBeGreaterThanOrEqual(2);
    expect(() => assertNoCommerceCanaries(dirty, "dirty")).toThrow(
      /canary leaked/,
    );
    const clean = redactCommerceSecrets(dirty);
    expect(findCommerceCanaries(clean)).toEqual([]);
    assertNoCommerceCanaries(clean, "clean");
  });

  it("mixed multi-surface dump is fully scrubbed", () => {
    const dump = [
      `IPC error: ${F.gd3}`,
      `stdio: lease=${F.leaseJwt}`,
      `diag privatePkcs8Base64=${F.privatePkcs8Base64}`,
      `sqlite: ${F.gd1} ${F.gd2}`,
      `journal grant=${F.grantToken}`,
      `temp nonce=${F.challengeNonce} signature=${F.activationSignature}`,
      `remote portalToken=${F.portalToken} magicToken=${F.magicToken}`,
      `jwk "d":"${F.privateJwkD}"`,
      `refresh signature=${F.refreshSignature}`,
    ].join("\n");
    const scrubbed = redactCommerceSecrets(dump);
    assertNoCommerceCanaries(scrubbed, "multi-surface dump");

    const structured = redactCommerceValue({
      productKey: F.gd3,
      lease: F.leaseJwt,
      privatePkcs8Base64: F.privatePkcs8Base64,
      signature: F.activationSignature,
      nonce: F.challengeNonce,
      portalToken: F.portalToken,
      magicToken: F.magicToken,
      grant: F.grantToken,
    });
    const withJwk = redactCommerceSecrets(
      JSON.stringify({
        ...structured,
        legacy: [F.gd1, F.gd2],
        jwk: { d: F.privateJwkD },
        free: `sig=${F.refreshSignature}`,
      }),
    );
    assertNoCommerceCanaries(withJwk, "structured+jwk");
  });
});
