import { describe, expect, it } from "vitest";
import {
  EntitlementApiError,
  STABLE_ERROR_CODES,
  STABLE_ERROR_MESSAGES,
} from "@grokdesk/entitlement-client";
import { CredentialStoreError } from "./types.js";
import {
  AUTHORITATIVE_DENIAL_CODES,
  denialCodeToAuthoritativeState,
  isAuthoritativeDenialCode,
  mapEntitlementError,
  mapStableErrorCode,
  recoveryActionForState,
  type RecoveryAction,
} from "./error-map.js";

describe("error-map", () => {
  it("maps every stable service code to a safe state and recovery action", () => {
    const seenRecovery = new Set<RecoveryAction>();
    for (const code of STABLE_ERROR_CODES) {
      const mapped = mapStableErrorCode(code);
      expect(mapped.code).toBe(code);
      expect(mapped.message).toBe(STABLE_ERROR_MESSAGES[code]);
      expect(mapped.state).toMatch(/^[a-z_]+$/);
      expect([
        "none",
        "retry",
        "portal",
        "purchase",
        "credential_help",
      ]).toContain(mapped.recoveryAction);
      seenRecovery.add(mapped.recoveryAction);
      // Never leak secrets through message.
      expect(mapped.message).not.toMatch(/GD3\./);
      expect(mapped.message).not.toMatch(/BEGIN PRIVATE/);
    }
    // Seat limit and denials send users to the portal.
    expect(mapStableErrorCode("seat_limit").recoveryAction).toBe("portal");
    expect(mapStableErrorCode("entitlement_revoked").recoveryAction).toBe(
      "portal",
    );
    expect(mapStableErrorCode("service_unavailable").retryable).toBe(true);
    expect(mapStableErrorCode("fulfillment_pending")).toMatchObject({
      state: "service_unavailable",
      recoveryAction: "retry",
      retryable: true,
    });
    expect(mapStableErrorCode("invalid_key_format").retryable).toBe(false);
    expect(seenRecovery.has("portal")).toBe(true);
    expect(seenRecovery.has("retry")).toBe(true);
  });

  it("maps EntitlementApiError without including body or crypto detail", () => {
    const err = new EntitlementApiError(
      "seat_limit",
      false,
      "req-abc",
      409,
    );
    // Attach a forbidden field that must never be read into the map.
    (err as unknown as { body?: string }).body = "GD3.secret.leak";
    const mapped = mapEntitlementError(err);
    expect(mapped).toEqual({
      code: "seat_limit",
      state: "seat_limit",
      recoveryAction: "portal",
      retryable: false,
      message: STABLE_ERROR_MESSAGES.seat_limit,
      requestId: "req-abc",
    });
    expect(JSON.stringify(mapped)).not.toContain("GD3.");
  });

  it("maps credential store failures to credential_help", () => {
    const mapped = mapEntitlementError(new CredentialStoreError());
    expect(mapped).toMatchObject({
      code: "credential_store_failure",
      state: "credential_store_failure",
      recoveryAction: "credential_help",
      retryable: false,
    });
  });

  it("maps extractGd3 failures and unknown throws without leaking", () => {
    expect(mapEntitlementError(new Error("multiple_keys")).code).toBe(
      "invalid_key_format",
    );
    expect(mapEntitlementError(new Error("invalid_key_format")).code).toBe(
      "invalid_key_format",
    );
    const unknown = mapEntitlementError(
      new Error("Error: failed verify at crypto: GD3.abc.def nonce=xyz"),
    );
    expect(unknown.code).toBe("service_unavailable");
    expect(JSON.stringify(unknown)).not.toContain("GD3.");
    expect(JSON.stringify(unknown)).not.toContain("nonce=");
  });

  it("classifies authoritative denial codes for immediate state write", () => {
    for (const code of AUTHORITATIVE_DENIAL_CODES) {
      expect(isAuthoritativeDenialCode(code)).toBe(true);
    }
    expect(isAuthoritativeDenialCode("seat_limit")).toBe(false);
    expect(isAuthoritativeDenialCode("service_unavailable")).toBe(false);
    expect(denialCodeToAuthoritativeState("entitlement_suspended")).toBe(
      "suspended",
    );
    expect(denialCodeToAuthoritativeState("entitlement_refunded")).toBe(
      "refunded",
    );
    expect(denialCodeToAuthoritativeState("entitlement_revoked")).toBe(
      "revoked",
    );
    expect(denialCodeToAuthoritativeState("device_deactivated")).toBe(
      "device_deactivated",
    );
  });

  it("maps desktop states to recovery actions", () => {
    expect(recoveryActionForState("active")).toBe("none");
    expect(recoveryActionForState("offline_grace")).toBe("none");
    expect(recoveryActionForState("unactivated")).toBe("purchase");
    expect(recoveryActionForState("seat_limit")).toBe("portal");
    expect(recoveryActionForState("credential_store_failure")).toBe(
      "credential_help",
    );
    expect(recoveryActionForState("service_unavailable")).toBe("retry");
  });
});
