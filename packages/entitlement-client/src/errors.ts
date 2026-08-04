/**
 * Transport and API error surface for the entitlement HTTP client.
 * Wire codes come from `@grokdesk/shared`; bodies never appear on errors.
 */

import {
  isStableErrorCode,
  type StableErrorCode,
} from "@grokdesk/shared";

/** Alias matching the enforcement plan / license package naming. */
export type StableEntitlementError = StableErrorCode;

export {
  STABLE_ERROR_CODES,
  stableErrorCodes,
  STABLE_ERROR_MESSAGES,
  STABLE_ERROR_STATUS,
  isStableErrorCode,
  type StableErrorCode,
} from "@grokdesk/shared";

export type EntitlementClientDiagnostics = {
  openApiSha256: string;
  lastOperationId?: string;
  lastStatus?: number;
  lastRequestId?: string;
  lastErrorCode?: string;
  lastRetryable?: boolean;
  lastRetryAfterMs?: number;
};

export class EntitlementApiError extends Error {
  readonly name = "EntitlementApiError";

  constructor(
    readonly code: StableEntitlementError,
    readonly retryable: boolean,
    readonly requestId?: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(code);
    // Ensure message is only the stable code — never response/request bodies.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      retryable: this.retryable,
      requestId: this.requestId,
      status: this.status,
      retryAfterMs: this.retryAfterMs,
    };
  }
}

/** 4xx stable denials are authoritative and not retryable by default. */
export function isAuthoritativeDenial(code: StableEntitlementError): boolean {
  return code !== "service_unavailable";
}

export function retryableForStatus(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const asInt = Number.parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt >= 0) {
    return asInt * 1000;
  }
  const when = Date.parse(header);
  if (Number.isFinite(when)) {
    const delta = when - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

/**
 * Map HTTP status + optional Error body to a stable client error.
 * Unknown/malformed bodies become service_unavailable without leaking content.
 */
export function mapHttpError(input: {
  status: number;
  body: unknown;
  requestIdHeader?: string | null;
  retryAfterHeader?: string | null;
}): EntitlementApiError {
  const retryAfterMs = parseRetryAfterMs(input.retryAfterHeader ?? null);
  let code: StableEntitlementError = "service_unavailable";
  let requestId: string | undefined =
    input.requestIdHeader?.trim() || undefined;

  if (input.body && typeof input.body === "object" && !Array.isArray(input.body)) {
    const rec = input.body as Record<string, unknown>;
    if (typeof rec.code === "string" && isStableErrorCode(rec.code)) {
      code = rec.code;
    }
    if (typeof rec.requestId === "string" && rec.requestId.length > 0) {
      requestId = rec.requestId;
    }
  }

  // Authoritative 4xx with known stable code → not retryable.
  // 429 / 5xx / unknown → retryable when status suggests it, else false for 4xx.
  let retryable: boolean;
  if (input.status === 429) {
    code = isStableErrorCode(code) && code !== "service_unavailable"
      ? code
      : "service_unavailable";
    retryable = true;
  } else if (input.status >= 500) {
    // Preserve stable service codes such as fulfillment_pending while still
    // treating the 5xx response as retryable. Unknown bodies defaulted to
    // service_unavailable above.
    retryable = true;
  } else if (input.status >= 400) {
    retryable = false;
    if (!isStableErrorCode(code) || code === "service_unavailable") {
      // Prefer body code when stable; otherwise keep service_unavailable non-retryable.
      if (typeof (input.body as { code?: unknown })?.code === "string") {
        const c = (input.body as { code: string }).code;
        if (isStableErrorCode(c)) code = c;
      }
    }
  } else {
    retryable = retryableForStatus(input.status);
  }

  return new EntitlementApiError(
    code,
    retryable,
    requestId,
    input.status,
    retryAfterMs,
  );
}

export function transportUnavailable(
  requestId?: string,
  status?: number,
): EntitlementApiError {
  return new EntitlementApiError(
    "service_unavailable",
    true,
    requestId,
    status,
  );
}
