import { describe, it, expect } from "vitest";
import {
  COMMERCE_CANARY_FIXTURES,
  allCommerceCanaryValues,
  assertNoCommerceCanaries,
} from "@grokdesk/shared";
import {
  redactSecrets,
  restartBackoffMs,
  shouldRestartGateway,
  MAX_GATEWAY_RESTARTS,
  formatSafeEntitlementLog,
} from "./redact";

describe("redactSecrets", () => {
  it("redacts API key assignments", () => {
    expect(redactSecrets("API_KEY=sk-abc1234567890 hello")).toMatch(
      /\[REDACTED\]/,
    );
    expect(redactSecrets("API_KEY=sk-abc1234567890 hello")).not.toMatch(
      /sk-abc/,
    );
  });

  it("redacts data URLs", () => {
    const s = "img data:image/png;base64,iVBORw0KGgoAAAANSUhEUg== tail";
    const out = redactSecrets(s);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toMatch(/iVBORw0KGgo/);
  });

  it("redacts PEM private keys", () => {
    const pem =
      "before -----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg\n-----END PRIVATE KEY----- after";
    expect(redactSecrets(pem)).toMatch(/\[REDACTED\]/);
    expect(redactSecrets(pem)).not.toMatch(/MIIEvg/);
  });

  it("leaves ordinary diagnostics intact", () => {
    const s = "Gateway ready on pid 12345";
    expect(redactSecrets(s)).toBe(s);
  });

  it("redacts loopback MCP host tokens", () => {
    const tok = "a".repeat(48);
    const out = redactSecrets(`GROKDESK_BROWSER_TOKEN=${tok} ready`);
    expect(out).toMatch(/\[REDACTED\]/);
    expect(out).not.toContain(tok);
  });

  it("redacts GD1/GD2/GD3 product key canaries", () => {
    for (const key of ["gd1", "gd2", "gd3"] as const) {
      const canary = COMMERCE_CANARY_FIXTURES[key];
      const out = redactSecrets(`activation failed key=${canary}`);
      expect(out).not.toContain(canary);
      expect(out).toContain("[REDACTED]");
    }
  });

  it("redacts signed lease JWT canaries", () => {
    const lease = COMMERCE_CANARY_FIXTURES.leaseJwt;
    const out = redactSecrets(`lease stored: ${lease}`);
    expect(out).not.toContain(lease);
    expect(out).not.toMatch(/eyJhbGciOiJFZERTQS/);
  });

  it("redacts PKCS#8 and private JWK material", () => {
    const pkcs8 = COMMERCE_CANARY_FIXTURES.privatePkcs8Base64;
    const jwk = `{"kty":"OKP","crv":"Ed25519","d":"${COMMERCE_CANARY_FIXTURES.privateJwkD}","x":"abc"}`;
    expect(redactSecrets(`pkcs8=${pkcs8}`)).not.toContain(pkcs8);
    const jwkOut = redactSecrets(jwk);
    expect(jwkOut).not.toContain(COMMERCE_CANARY_FIXTURES.privateJwkD);
  });

  it("redacts activation/refresh signatures, nonces, and portal/magic/grant tokens", () => {
    const samples = [
      `signature: ${COMMERCE_CANARY_FIXTURES.activationSignature}`,
      `signature=${COMMERCE_CANARY_FIXTURES.refreshSignature}`,
      `nonce: ${COMMERCE_CANARY_FIXTURES.challengeNonce}`,
      `portalToken=${COMMERCE_CANARY_FIXTURES.portalToken}`,
      `magicToken: ${COMMERCE_CANARY_FIXTURES.magicToken}`,
      `grant=${COMMERCE_CANARY_FIXTURES.grantToken}`,
      `https://cdn.example/redeem?grant=${COMMERCE_CANARY_FIXTURES.grantToken}`,
    ];
    for (const s of samples) {
      const out = redactSecrets(s);
      assertNoCommerceCanaries(out, `redactSecrets(${s.slice(0, 40)})`);
    }
  });
});

describe("formatSafeEntitlementLog", () => {
  it("logs only event, code, platform, architecture, retry class, correlation id", () => {
    const line = formatSafeEntitlementLog({
      event: "entitlement.activate",
      code: "seat_limit",
      platform: "darwin",
      architecture: "arm64",
      retryClass: "non_retryable",
      correlationId: "req-corr-001",
    });
    expect(line).toContain("event=entitlement.activate");
    expect(line).toContain("code=seat_limit");
    expect(line).toContain("platform=darwin");
    expect(line).toContain("architecture=arm64");
    expect(line).toContain("retryClass=non_retryable");
    expect(line).toContain("correlationId=req-corr-001");
    // Must not smuggle canaries even if someone puts them in free-form fields.
    const poisoned = formatSafeEntitlementLog({
      event: `activate ${COMMERCE_CANARY_FIXTURES.gd3}`,
      code: COMMERCE_CANARY_FIXTURES.gd3,
      correlationId: COMMERCE_CANARY_FIXTURES.grantToken,
    });
    assertNoCommerceCanaries(poisoned, "formatSafeEntitlementLog poisoned");
    expect(poisoned).toContain("code=redacted");
    expect(poisoned).toContain("correlationId=redacted");
  });

  it("never includes fetch request/response body fields", () => {
    // Only SafeEntitlementLogFields are accepted — body is not a field.
    const line = formatSafeEntitlementLog({
      event: "entitlement.refresh",
      code: "service_unavailable",
      retryClass: "retryable",
      correlationId: "req-1",
    });
    expect(line).not.toMatch(/body|payload|response|requestBody/i);
    const keys = line.split(" ").map((p) => p.split("=")[0]);
    for (const k of keys) {
      expect([
        "event",
        "code",
        "platform",
        "architecture",
        "retryClass",
        "correlationId",
      ]).toContain(k);
    }
  });
});

describe("commerce canary sweep via redactSecrets", () => {
  it("strips every canary fixture from a mixed diagnostic dump", () => {
    const f = COMMERCE_CANARY_FIXTURES;
    const dump = [
      `line0 productKey=${f.gd1}`,
      `line1 productKey=${f.gd2}`,
      `line2 productKey=${f.gd3}`,
      `line3 lease=${f.leaseJwt}`,
      `line4 privatePkcs8Base64=${f.privatePkcs8Base64}`,
      `line5 "d":"${f.privateJwkD}"`,
      `line6 signature=${f.activationSignature}`,
      `line7 signature=${f.refreshSignature}`,
      `line8 nonce=${f.challengeNonce}`,
      `line9 portalToken=${f.portalToken}`,
      `line10 magicToken=${f.magicToken}`,
      `line11 grant=${f.grantToken}`,
    ].join("\n");
    const out = redactSecrets(dump);
    assertNoCommerceCanaries(out, "mixed diagnostic dump");
    expect(allCommerceCanaryValues().length).toBeGreaterThanOrEqual(12);
  });
});

describe("restart policy", () => {
  it("backoff doubles from 500ms", () => {
    expect(restartBackoffMs(0)).toBe(500);
    expect(restartBackoffMs(1)).toBe(1000);
    expect(restartBackoffMs(2)).toBe(2000);
  });

  it("restarts only after ready and under max", () => {
    expect(
      shouldRestartGateway({
        intentionalStop: false,
        wasReady: true,
        restartCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldRestartGateway({
        intentionalStop: false,
        wasReady: true,
        restartCount: MAX_GATEWAY_RESTARTS,
      }),
    ).toBe(false);
    expect(
      shouldRestartGateway({
        intentionalStop: true,
        wasReady: true,
        restartCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldRestartGateway({
        intentionalStop: false,
        wasReady: false,
        restartCount: 0,
      }),
    ).toBe(false);
  });
});
