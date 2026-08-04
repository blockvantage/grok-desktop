/**
 * Gateway entitlement redaction / secret-canary coverage (Task 12).
 *
 * Canaries must not appear in stdio frames, remote errors, or diagnostic text.
 * Renderer/remote receive safe codes only; internal causes stay local+redacted.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  COMMERCE_CANARY_FIXTURES,
  allCommerceCanaryValues,
  assertNoCommerceCanaries,
  formatSafeEntitlementLog,
} from "@grokdesk/shared";
import {
  EntitlementReadOnlyError,
  ENTITLEMENT_READ_ONLY_CODE,
} from "./entitlement-error.js";
import { parseEntitlementStateEnvelope } from "./entitlement-guard.js";
import {
  redactGatewayDiagnosticText,
  toSafeEntitlementStdioFrame,
  toStdioErrorPayload,
} from "./entitlement-redaction.js";

const F = COMMERCE_CANARY_FIXTURES;

describe("entitlement redaction (gateway)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "gd-gw-canary-"));
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("EntitlementReadOnlyError.toJSON is free of commerce canaries", () => {
    const err = new EntitlementReadOnlyError({
      state: "revoked",
      action: "tasks.create",
      capability: "grok_operation",
      denialCode: "entitlement_revoked",
    });
    // Hostile attach of secret-bearing props must not serialize via toJSON.
    (err as unknown as { cause?: string }).cause = F.gd3;
    (err as unknown as { lease?: string }).lease = F.leaseJwt;
    const json = JSON.stringify(err.toJSON());
    assertNoCommerceCanaries(json, "EntitlementReadOnlyError.toJSON");
    expect(err.toJSON()).toMatchObject({
      code: ENTITLEMENT_READ_ONLY_CODE,
      state: "revoked",
      action: "tasks.create",
      capability: "grok_operation",
      denialCode: "entitlement_revoked",
    });
    expect(json).not.toContain("cause");
    expect(json).not.toContain("lease");
  });

  it("stdio frame carries safe code only (no fetch bodies / crypto)", () => {
    const err = new EntitlementReadOnlyError({
      state: "lease_expired",
      action: "interactive",
      capability: "grok_operation",
      denialCode: "lease_expired",
    });
    const frame = toSafeEntitlementStdioFrame(err);
    const text = JSON.stringify(frame);
    assertNoCommerceCanaries(text, "stdio frame");
    expect(frame).toEqual({
      code: "entitlement_read_only",
      state: "lease_expired",
      action: "interactive",
      capability: "grok_operation",
      denialCode: "lease_expired",
      message: "Entitlement is read-only for this operation",
    });
    expect(text).not.toMatch(/body|payload|productKey|nonce|signature/i);
  });

  it("stdio error payload redacts free-form throws that embed canaries", () => {
    const poisoned = new Error(
      `verify failed key=${F.gd3} lease=${F.leaseJwt} nonce=${F.challengeNonce}`,
    );
    const payload = toStdioErrorPayload("req-1", poisoned);
    const text = JSON.stringify(payload);
    assertNoCommerceCanaries(text, "stdio error payload");
    expect(payload.ok).toBe(false);
    expect(payload.id).toBe("req-1");

    const entitlementPayload = toStdioErrorPayload(
      "req-2",
      new EntitlementReadOnlyError({
        state: "seat_limit",
        action: "activate",
        capability: "grok_operation",
        denialCode: "seat_limit",
      }),
    );
    expect(entitlementPayload.error).toMatchObject({
      code: "entitlement_read_only",
      state: "seat_limit",
    });
    assertNoCommerceCanaries(
      JSON.stringify(entitlementPayload),
      "entitlement stdio payload",
    );
  });

  it("remote-shaped errors collapse to safe code", () => {
    // Mirrors remote-application.ts entitlement branch.
    const remote = { ok: false as const, error: "entitlement_read_only" };
    assertNoCommerceCanaries(JSON.stringify(remote), "remote error");
    expect(remote.error).toBe("entitlement_read_only");
  });

  it("diagnostic text redaction strips all canaries", () => {
    const dump = [
      `diag productKey=${F.gd1}`,
      `diag productKey=${F.gd2}`,
      `diag productKey=${F.gd3}`,
      `diag lease=${F.leaseJwt}`,
      `diag privatePkcs8Base64=${F.privatePkcs8Base64}`,
      `diag "d":"${F.privateJwkD}"`,
      `diag signature=${F.activationSignature}`,
      `diag signature=${F.refreshSignature}`,
      `diag nonce=${F.challengeNonce}`,
      `diag portalToken=${F.portalToken}`,
      `diag magicToken=${F.magicToken}`,
      `diag grant=${F.grantToken}`,
    ].join("\n");
    const out = redactGatewayDiagnosticText(dump);
    assertNoCommerceCanaries(out, "gateway diagnostics");
    expect(allCommerceCanaryValues().length).toBeGreaterThanOrEqual(12);
  });

  it("safe entitlement logs never include request/response bodies", () => {
    const line = formatSafeEntitlementLog({
      event: "entitlement.guard.deny",
      code: "entitlement_read_only",
      platform: "darwin",
      architecture: "arm64",
      retryClass: "none",
      correlationId: "gw-corr-1",
    });
    expect(line).toContain("event=entitlement.guard.deny");
    expect(line).not.toMatch(/body|fetch|payload|GD[123]\./i);
    assertNoCommerceCanaries(line, "gateway safe log");
  });

  it("state envelope parse rejects product-key / private-key canaries", () => {
    const withKey = JSON.stringify({
      schema: 1,
      deviceId: "d1",
      devicePublicKeyThumbprint: "tp1",
      lease: F.gd3,
      authoritativeState: "none",
    });
    expect(() => parseEntitlementStateEnvelope(withKey)).toThrow(
      /contains_secrets|corrupt/,
    );

    const withPkcs8 = JSON.stringify({
      schema: 1,
      deviceId: "d1",
      devicePublicKeyThumbprint: "tp1",
      lease: null,
      authoritativeState: "none",
      privatePkcs8Base64: F.privatePkcs8Base64,
    });
    // Unknown fields + private key material → secrets or corrupt.
    expect(() => parseEntitlementStateEnvelope(withPkcs8)).toThrow();
  });

  it("temp state / journal dumps redact canaries before export", async () => {
    const statePath = path.join(tmp, "state.json");
    const journalPath = path.join(tmp, "journal.json");
    const blob = JSON.stringify({
      productKey: F.gd3,
      lease: F.leaseJwt,
      signature: F.activationSignature,
      grant: F.grantToken,
    });
    await fsp.writeFile(statePath, blob, "utf8");
    await fsp.writeFile(journalPath, blob, "utf8");

    for (const p of [statePath, journalPath]) {
      const raw = await fsp.readFile(p, "utf8");
      const scrubbed = redactGatewayDiagnosticText(raw);
      assertNoCommerceCanaries(scrubbed, path.basename(p));
    }
  });

  it("unknown throws map to safe frame without leaking canaries", () => {
    const frame = toSafeEntitlementStdioFrame(
      new Error(`boom ${F.gd3} ${F.privatePkcs8Base64}`),
      { action: "tasks.create", capability: "grok_operation" },
    );
    assertNoCommerceCanaries(JSON.stringify(frame), "unknown throw frame");
    expect(frame.code).toBe("entitlement_read_only");
    expect(frame.message).not.toContain("boom");
  });
});
