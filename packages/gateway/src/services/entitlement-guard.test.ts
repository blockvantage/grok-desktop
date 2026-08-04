/**
 * Entitlement guard — shared Grok admission boundary (Task 8 partial).
 *
 * Blocks grok_operation when lease is invalid/denied; preserves local_read /
 * local_manage / recovery (view, export, settings, diagnostics, cancel, delete).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DeviceLeaseClaims, PublicJwk } from "@grokdesk/license";
import {
  createEntitlementGuard,
  isEntitlementReadOnlyError,
  type EntitlementGuard,
  type EntitlementStateEnvelope,
} from "./entitlement-guard.js";
import { EntitlementReadOnlyError } from "./entitlement-error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(
  __dirname,
  "../../../license/testdata/crypto/v1",
);

const leaseDoc = JSON.parse(
  readFileSync(path.join(vectorsDir, "device-leases.json"), "utf8"),
) as {
  fixedClockSeconds: number;
  claims: {
    iss: string;
    aud: string;
    deviceThumbprint: string;
    entitlementId: string;
    activationId: string;
  };
  keys: {
    lease: {
      kid: string;
      publicJwk: PublicJwk;
    };
  };
  expectedLease: string;
  cases: Array<{
    name: string;
    type: string;
    input: { lease: string };
    options?: { expectedDeviceThumbprint?: string };
  }>;
};

const FIXED_NOW = leaseDoc.fixedClockSeconds;
const PUBLIC_JWK = leaseDoc.keys.lease.publicJwk;
const VALID_LEASE = leaseDoc.expectedLease;
const DEVICE_TP = leaseDoc.claims.deviceThumbprint;
const ISS = leaseDoc.claims.iss;
const AUD = leaseDoc.claims.aud;

function caseLease(name: string): string {
  const c = leaseDoc.cases.find((x) => x.name === name);
  if (!c) throw new Error(`missing vector case ${name}`);
  return c.input.lease;
}

function baseState(
  overrides: Partial<EntitlementStateEnvelope> = {},
): EntitlementStateEnvelope {
  return {
    schema: 1,
    deviceId: "device-uuid-test-1",
    devicePublicKeyThumbprint: DEVICE_TP,
    lease: VALID_LEASE,
    authoritativeState: "none",
    updatedAt: new Date(FIXED_NOW * 1000).toISOString(),
    requestId: null,
    ...overrides,
  };
}

function activeClaims(
  overrides: Partial<DeviceLeaseClaims> = {},
): DeviceLeaseClaims {
  return {
    iss: ISS,
    aud: AUD,
    entitlementId: leaseDoc.claims.entitlementId,
    activationId: leaseDoc.claims.activationId,
    deviceThumbprint: DEVICE_TP,
    productId: "grok-desk",
    capabilities: ["grok-runtime"],
    seatLimit: 3,
    updatePolicy: "lifetime_stable",
    iat: FIXED_NOW,
    refreshAfter: FIXED_NOW + 86_400,
    exp: FIXED_NOW + 30 * 86_400,
    jti: "lease-jti-test",
    ...overrides,
  };
}

function guardFromState(
  state: EntitlementStateEnvelope | null,
  opts: {
    nowSeconds?: number;
    injectVerifiedClaims?: DeviceLeaseClaims | null;
  } = {},
): EntitlementGuard {
  return createEntitlementGuard({
    keyRing: new Map([[leaseDoc.keys.lease.kid, PUBLIC_JWK]]),
    expectedIssuer: ISS,
    expectedAudience: AUD,
    nowSeconds: () => opts.nowSeconds ?? FIXED_NOW,
    clockToleranceSeconds: 0,
    loadState: () => state,
    injectVerifiedClaims: opts.injectVerifiedClaims,
  });
}

describe("EntitlementGuard", () => {
  describe("active lease", () => {
    it("allows grok_operation and all local/recovery capabilities", async () => {
      const guard = guardFromState(baseState());
      await expect(
        guard.assertCapability("grok_operation", "interactive"),
      ).resolves.toBeUndefined();
      await expect(
        guard.assertCapability("local_read", "export_chat"),
      ).resolves.toBeUndefined();
      await expect(
        guard.assertCapability("local_manage", "rename_task"),
      ).resolves.toBeUndefined();
      await expect(
        guard.assertCapability("recovery", "refresh_license"),
      ).resolves.toBeUndefined();

      const snap = await guard.refresh();
      expect(snap.grokAllowed).toBe(true);
      expect(snap.state).toBe("active");
      expect(snap.hasVerifiedLease).toBe(true);
      // Safe surface only — no lease token or claim fields.
      expect(JSON.stringify(snap)).not.toMatch(/eyJ/);
      expect(JSON.stringify(snap)).not.toContain("entitlementId");
      expect(JSON.stringify(snap)).not.toContain(VALID_LEASE);
    });

    it("allows grok when refresh_due (still within exp)", async () => {
      const claims = activeClaims({
        refreshAfter: FIXED_NOW - 10,
        exp: FIXED_NOW + 1000,
      });
      const guard = guardFromState(baseState(), {
        injectVerifiedClaims: claims,
      });
      const snap = await guard.refresh();
      expect(snap.state).toBe("refresh_due");
      expect(snap.grokAllowed).toBe(true);
      await guard.assertCapability("grok_operation", "follow_up");
    });
  });

  describe("expired lease", () => {
    it("blocks grok_operation with entitlement_read_only / lease_expired", async () => {
      const guard = guardFromState(
        baseState({ lease: caseLease("expired") }),
      );
      const check = await guard.checkCapability(
        "grok_operation",
        "scheduled",
      );
      expect(check).toMatchObject({
        ok: false,
        code: "entitlement_read_only",
        state: "lease_expired",
        action: "scheduled",
        capability: "grok_operation",
      });

      await expect(
        guard.assertCapability("grok_operation", "provider_inference"),
      ).rejects.toSatisfy((err: unknown) => {
        expect(isEntitlementReadOnlyError(err)).toBe(true);
        const e = err as EntitlementReadOnlyError;
        expect(e.code).toBe("entitlement_read_only");
        expect(e.state).toBe("lease_expired");
        expect(e.action).toBe("provider_inference");
        expect(e.message).not.toMatch(/eyJ/);
        expect(JSON.stringify(e)).not.toContain("entitlementId");
        return true;
      });
    });

    it("still allows read/export/recovery when expired", async () => {
      const guard = guardFromState(
        baseState({ lease: caseLease("expired") }),
      );
      await guard.assertCapability("local_read", "list_conversations");
      await guard.assertCapability("local_read", "export_artifacts");
      await guard.assertCapability("recovery", "entitlement_portal");
      await guard.assertCapability("local_manage", "edit_settings");
    });
  });

  describe("revoked / suspended authoritative denial", () => {
    it("blocks grok when revoked even if lease token still present", async () => {
      const guard = guardFromState(
        baseState({ authoritativeState: "revoked" }),
      );
      await expect(
        guard.assertCapability("grok_operation", "interactive"),
      ).rejects.toMatchObject({
        code: "entitlement_read_only",
        state: "revoked",
      });
      const snap = await guard.refresh();
      expect(snap.grokAllowed).toBe(false);
      expect(snap.state).toBe("revoked");
      expect(snap.denialCode).toBe("entitlement_revoked");
    });

    it("blocks grok when suspended; preserves local_read", async () => {
      const guard = guardFromState(
        baseState({ authoritativeState: "suspended" }),
      );
      await expect(
        guard.assertCapability("grok_operation", "retry"),
      ).rejects.toMatchObject({
        code: "entitlement_read_only",
        state: "suspended",
      });
      await guard.assertCapability("local_read", "view_task");
      const snap = await guard.refresh();
      expect(snap.denialCode).toBe("entitlement_suspended");
    });

    it("blocks grok when refunded", async () => {
      const guard = guardFromState(
        baseState({ authoritativeState: "refunded" }),
      );
      await expect(
        guard.assertCapability("grok_operation", "remote"),
      ).rejects.toMatchObject({
        code: "entitlement_read_only",
        state: "refunded",
      });
    });

    it("blocks grok when device_deactivated", async () => {
      const guard = guardFromState(
        baseState({ authoritativeState: "device_deactivated" }),
      );
      await expect(
        guard.assertCapability("grok_operation", "dictation"),
      ).rejects.toMatchObject({
        code: "entitlement_read_only",
        state: "device_deactivated",
      });
    });
  });

  describe("device mismatch", () => {
    it("blocks grok when lease is bound to another device", async () => {
      // wrong_device vector: lease thumbprint differs from expected (state) thumbprint
      const guard = guardFromState(
        baseState({
          lease: caseLease("wrong_device"),
          devicePublicKeyThumbprint: DEVICE_TP,
        }),
      );
      await expect(
        guard.assertCapability("grok_operation", "interactive"),
      ).rejects.toMatchObject({
        code: "entitlement_read_only",
        state: "read_only",
      });
      const snap = await guard.refresh();
      expect(snap.denialCode).toBe("lease_device_mismatch");
      expect(snap.grokAllowed).toBe(false);
      await guard.assertCapability("local_read", "export");
    });
  });

  describe("missing / invalid lease", () => {
    it("blocks grok when unactivated (no lease)", async () => {
      const guard = guardFromState(baseState({ lease: null }));
      await expect(
        guard.assertCapability("grok_operation", "interactive"),
      ).rejects.toMatchObject({
        code: "entitlement_read_only",
        state: "unactivated",
      });
      await guard.assertCapability("recovery", "activate");
    });

    it("blocks grok on tampered lease signature", async () => {
      const guard = guardFromState(
        baseState({ lease: caseLease("tampered") }),
      );
      await expect(
        guard.assertCapability("grok_operation", "title_generation"),
      ).rejects.toMatchObject({
        code: "entitlement_read_only",
      });
      const snap = await guard.refresh();
      expect(snap.grokAllowed).toBe(false);
      expect(snap.hasVerifiedLease).toBe(false);
    });

    it("blocks grok when state file is absent", async () => {
      const guard = guardFromState(null);
      await expect(
        guard.assertCapability("grok_operation", "queued_execution"),
      ).rejects.toMatchObject({
        code: "entitlement_read_only",
        state: "unactivated",
      });
    });
  });

  describe("state file on disk", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ent-guard-"));
    });

    it("verifies lease from atomic state path and re-reads on mtime change", async () => {
      const statePath = path.join(tmpDir, "state.json");
      const writeState = async (state: EntitlementStateEnvelope) => {
        await fsp.writeFile(statePath, `${JSON.stringify(state)}\n`, "utf8");
      };

      await writeState(baseState());
      const guard = createEntitlementGuard({
        statePath,
        keyRing: new Map([[leaseDoc.keys.lease.kid, PUBLIC_JWK]]),
        expectedIssuer: ISS,
        expectedAudience: AUD,
        nowSeconds: () => FIXED_NOW,
        clockToleranceSeconds: 0,
      });

      await guard.assertCapability("grok_operation", "interactive");
      expect((await guard.refresh()).state).toBe("active");

      // Authoritative revocation written by main process.
      await writeState(baseState({ authoritativeState: "revoked" }));
      // Ensure mtime advances on coarse filesystems.
      const st = await fsp.stat(statePath);
      await fsp.utimes(
        statePath,
        st.atime,
        new Date(st.mtimeMs + 1000),
      );

      await expect(
        guard.assertCapability("grok_operation", "interactive"),
      ).rejects.toMatchObject({
        code: "entitlement_read_only",
        state: "revoked",
      });
    });

    it("rejects state containing product-key canaries", async () => {
      const statePath = path.join(tmpDir, "state.json");
      await fsp.writeFile(
        statePath,
        JSON.stringify({
          schema: 1,
          deviceId: "d",
          devicePublicKeyThumbprint: DEVICE_TP,
          lease: "GD3.abc.def",
          authoritativeState: "none",
          updatedAt: new Date().toISOString(),
          requestId: null,
        }),
        "utf8",
      );
      const guard = createEntitlementGuard({
        statePath,
        keyRing: PUBLIC_JWK,
        expectedIssuer: ISS,
        expectedAudience: AUD,
        nowSeconds: () => FIXED_NOW,
      });
      await expect(
        guard.assertCapability("grok_operation", "interactive"),
      ).rejects.toMatchObject({
        code: "entitlement_read_only",
      });
      // Never echo the product key material in the error.
      try {
        await guard.assertCapability("grok_operation", "interactive");
      } catch (err) {
        expect(JSON.stringify(err)).not.toContain("GD3.");
      }
    });
  });

  describe("injected verified claims", () => {
    it("supports inject path without disk or crypto (host unit tests)", async () => {
      const guard = createEntitlementGuard({
        keyRing: PUBLIC_JWK,
        expectedIssuer: ISS,
        expectedAudience: AUD,
        nowSeconds: () => FIXED_NOW,
        injectVerifiedClaims: activeClaims(),
        loadState: () =>
          baseState({
            lease: null, // claims injection wins for verification
            authoritativeState: "none",
          }),
      });
      await guard.assertCapability("grok_operation", "interactive");
    });
  });

  describe("error safety", () => {
    it("EntitlementReadOnlyError never serializes lease or claims", () => {
      const err = new EntitlementReadOnlyError({
        state: "lease_expired",
        action: "interactive",
        capability: "grok_operation",
        denialCode: "lease_expired",
      });
      const bag = JSON.stringify(err);
      expect(bag).not.toMatch(/eyJ/);
      expect(bag).not.toContain("claims");
      expect(err.code).toBe("entitlement_read_only");
      expect(err.name).toBe("EntitlementReadOnlyError");
    });
  });
});
