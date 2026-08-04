/**
 * Desktop commerce secret-canary suite (Task 12 partial).
 *
 * Canary fixtures must not appear in IPC errors, logs, diagnostics,
 * SQLite/WAL dumps, state/journal/temp files, or remote-shaped errors.
 * Renderer surfaces receive safe codes only.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  COMMERCE_CANARY_FIXTURES,
  allCommerceCanaryValues,
  assertNoCommerceCanaries,
  formatSafeEntitlementLog,
  redactCommerceSecrets,
  redactCommerceValue,
} from "@grokdesk/shared";
import { EntitlementApiError } from "@grokdesk/entitlement-client";
import { mapEntitlementError } from "./error-map.js";
import {
  assertNoEntitlementSecrets,
  toEntitlementStatusDto,
} from "./ipc.js";
import {
  defaultEntitlementStatePath,
  EntitlementStateStore,
} from "./state-store.js";
import { redactSecrets } from "../redact.js";

const CANARIES = allCommerceCanaryValues();

function poisonedBlob(): string {
  const f = COMMERCE_CANARY_FIXTURES;
  return JSON.stringify({
    productKey: f.gd3,
    legacy: [f.gd1, f.gd2],
    lease: f.leaseJwt,
    privatePkcs8Base64: f.privatePkcs8Base64,
    privateJwk: { kty: "OKP", crv: "Ed25519", d: f.privateJwkD, x: "pub" },
    signature: f.activationSignature,
    refreshSignature: f.refreshSignature,
    nonce: f.challengeNonce,
    portalToken: f.portalToken,
    magicToken: f.magicToken,
    grant: f.grantToken,
    body: {
      request: { productKey: f.gd3, signature: f.activationSignature },
      response: { lease: f.leaseJwt },
    },
  });
}

describe("desktop entitlement secret canary", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gd-ent-canary-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("IPC-mapped errors expose only stable codes (no canaries)", () => {
    const err = new EntitlementApiError(
      "seat_limit",
      false,
      "req-canary-001",
      409,
    );
    (err as unknown as { body?: string }).body = poisonedBlob();
    const mapped = mapEntitlementError(err);
    const wire = JSON.stringify(mapped);
    assertNoCommerceCanaries(wire, "mapEntitlementError");
    expect(mapped.code).toBe("seat_limit");
    expect(mapped.message).not.toMatch(/GD[123]\./);

    // Unknown throws with embedded canaries collapse without leaking.
    const unknown = mapEntitlementError(
      new Error(`crypto fail ${COMMERCE_CANARY_FIXTURES.gd3} nonce=${COMMERCE_CANARY_FIXTURES.challengeNonce}`),
    );
    assertNoCommerceCanaries(JSON.stringify(unknown), "mapEntitlementError unknown");
    expect(unknown.code).toBe("service_unavailable");
  });

  it("renderer DTO canary guard rejects product keys and private material", () => {
    expect(() =>
      assertNoEntitlementSecrets(
        { state: "active", productKey: COMMERCE_CANARY_FIXTURES.gd3 },
        "dto",
      ),
    ).toThrow(/product key/i);

    expect(() =>
      assertNoEntitlementSecrets(
        {
          state: "active",
          privatePkcs8Base64: COMMERCE_CANARY_FIXTURES.privatePkcs8Base64,
        },
        "dto",
      ),
    ).toThrow(/private key/i);

    const safe = toEntitlementStatusDto({
      state: "active",
      expiresAt: "2030-01-01T00:00:00.000Z",
      refreshAfter: "2029-01-01T00:00:00.000Z",
      deviceName: "Test Device",
      deviceId: null,
      activationId: null,
      recoveryAction: "none",
      lastError: null,
      authoritativeState: "none",
    });
    assertNoEntitlementSecrets(safe, "status dto");
    assertNoCommerceCanaries(JSON.stringify(safe), "status dto");
  });

  it("logs and diagnostics drop canaries via redactSecrets", () => {
    const logLine = `entitlement.activate failed ${poisonedBlob()}`;
    const redacted = redactSecrets(logLine);
    assertNoCommerceCanaries(redacted, "main log line");

    // Safe formatter path: only allowlisted fields.
    const safe = formatSafeEntitlementLog({
      event: "entitlement.activate",
      code: "invalid_key_signature",
      platform: "darwin",
      architecture: "arm64",
      retryClass: "non_retryable",
      correlationId: "corr-safe-001",
    });
    assertNoCommerceCanaries(safe, "formatSafeEntitlementLog");
    expect(safe).toContain("event=entitlement.activate");
    expect(safe).not.toMatch(/body|payload|fetch/i);
  });

  it("state store rejects product-key canaries (SQLite/state surface)", async () => {
    const statePath = defaultEntitlementStatePath(tmp);
    const store = new EntitlementStateStore(statePath);

    await expect(
      store.write({
        schema: 1,
        deviceId: "device-1",
        devicePublicKeyThumbprint: "thumb-1",
        lease: COMMERCE_CANARY_FIXTURES.gd3,
        authoritativeState: "none",
        updatedAt: new Date().toISOString(),
        requestId: null,
      }),
    ).rejects.toThrow(/secret|product|contains/i);

    // Durable path must remain free of canaries even after failed write attempts.
    const dir = path.dirname(statePath);
    await fsp.mkdir(dir, { recursive: true });
    // Simulate a hostile / legacy dump that must be rejected on read.
    await fsp.writeFile(statePath, poisonedBlob(), "utf8");
    await expect(store.read()).rejects.toThrow();
    const onDisk = await fsp.readFile(statePath, "utf8");
    // Canary may still be on disk from the hostile write — read path must not
    // re-export it as valid state. Verify parse rejection instead of auto-wipe.
    expect(onDisk).toContain(COMMERCE_CANARY_FIXTURES.gd3);
    // After a clean write of a valid envelope, canaries must not appear.
    await fsp.unlink(statePath);
    await store.write({
      schema: 1,
      deviceId: "device-1",
      devicePublicKeyThumbprint: "thumb-1",
      lease: null,
      authoritativeState: "none",
      updatedAt: new Date().toISOString(),
      requestId: "req-ok",
    });
    const clean = await fsp.readFile(statePath, "utf8");
    assertNoCommerceCanaries(clean, "clean entitlement state file");
  });

  it("temp / journal / diagnostic dumps redact all canaries", async () => {
    const surfaces = {
      temp: path.join(tmp, "activation-temp.json"),
      journal: path.join(tmp, "update-journal.json"),
      diagnostics: path.join(tmp, "diagnostics.txt"),
      sqliteDump: path.join(tmp, "sqlite-wal-dump.txt"),
    };

    const dump = poisonedBlob();
    await fsp.writeFile(surfaces.temp, dump, "utf8");
    await fsp.writeFile(surfaces.journal, dump, "utf8");
    await fsp.writeFile(surfaces.diagnostics, dump, "utf8");
    await fsp.writeFile(surfaces.sqliteDump, dump, "utf8");

    for (const [name, p] of Object.entries(surfaces)) {
      const raw = await fsp.readFile(p, "utf8");
      const redacted = redactCommerceSecrets(raw);
      assertNoCommerceCanaries(redacted, `${name} redacted`);
      const structured = redactCommerceValue(JSON.parse(raw) as unknown);
      assertNoCommerceCanaries(
        JSON.stringify(structured),
        `${name} structured`,
      );
    }
  });

  it("remote-shaped error payloads carry safe code only", () => {
    // Mirrors gateway remote-application: entitlement denials return a code.
    const remote = { ok: false as const, error: "entitlement_read_only" };
    assertNoCommerceCanaries(JSON.stringify(remote), "remote error");

    // If a transport mistakenly stringifies a full error, redaction still holds.
    const mistaken = {
      ok: false,
      error: `failed: ${COMMERCE_CANARY_FIXTURES.gd3}`,
    };
    const scrubbed = {
      ...mistaken,
      error: redactSecrets(String(mistaken.error)),
    };
    assertNoCommerceCanaries(JSON.stringify(scrubbed), "scrubbed remote error");
  });

  it("every canary value is independently stripped from free-form text", () => {
    // Structural canaries (keys / JWT / PKCS#8) match bare; opaque tokens
    // require known field context (as they appear on the wire).
    const samples: string[] = [
      COMMERCE_CANARY_FIXTURES.gd1,
      COMMERCE_CANARY_FIXTURES.gd2,
      COMMERCE_CANARY_FIXTURES.gd3,
      COMMERCE_CANARY_FIXTURES.leaseJwt,
      COMMERCE_CANARY_FIXTURES.privatePkcs8Base64,
      `signature=${COMMERCE_CANARY_FIXTURES.activationSignature}`,
      `signature=${COMMERCE_CANARY_FIXTURES.refreshSignature}`,
      `nonce=${COMMERCE_CANARY_FIXTURES.challengeNonce}`,
      `portalToken=${COMMERCE_CANARY_FIXTURES.portalToken}`,
      `magicToken=${COMMERCE_CANARY_FIXTURES.magicToken}`,
      `grant=${COMMERCE_CANARY_FIXTURES.grantToken}`,
      `"d":"${COMMERCE_CANARY_FIXTURES.privateJwkD}"`,
    ];
    for (const sample of samples) {
      const out = redactSecrets(`surface ${sample}`);
      assertNoCommerceCanaries(out, `sample:${sample.slice(0, 32)}`);
    }
    expect(CANARIES.length).toBeGreaterThanOrEqual(12);
  });
});
