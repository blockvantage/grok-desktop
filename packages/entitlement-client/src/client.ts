/**
 * Typed HTTP transport for the public entitlement API surface.
 *
 * Safety invariants:
 * - Accept JSON only (except documented redeem redirect).
 * - Cap response bodies at 64 KiB.
 * - Default 8s timeout for activation/refresh paths.
 * - Reject redirects except redeemDownload.
 * - Never put request/response bodies into errors or diagnostics.
 */

import { OPENAPI_SHA256, OPERATIONS } from "./generated/api.js";
import type {
  createActivationChallengeRequest,
  createActivationChallengeResponse,
  createActivationRequest,
  createActivationResponse,
  exchangeLegacyGd2Request,
  exchangeLegacyGd2Response,
  createDeactivationChallengeRequest,
  createDeactivationChallengeResponse,
  deleteCurrentActivationRequest,
  deleteCurrentActivationResponse,
  createLeaseChallengeRequest,
  createLeaseChallengeResponse,
  refreshLeaseRequest,
  refreshLeaseResponse,
  getWellKnownGrokdeskKeysResponse,
  getReleaseManifestQuery,
  getReleaseManifestResponse,
  resolveReleaseRequest,
  resolveReleaseResponse,
  createDownloadGrantRequest,
  createDownloadGrantResponse,
  redeemDownloadQuery,
  redeemDownloadResponse,
  getHealthzResponse,
  getReadyzResponse,
  PublicOperationId,
} from "./generated/api.js";
import {
  EntitlementApiError,
  mapHttpError,
  transportUnavailable,
  type EntitlementClientDiagnostics,
} from "./errors.js";

export const DEFAULT_TIMEOUT_MS = 8_000;
export const MAX_BODY_BYTES = 64 * 1024;

export type EntitlementClientOptions = {
  baseUrl: URL;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  userAgent: string;
};

type DiagnosticsState = {
  lastOperationId?: string;
  lastStatus?: number;
  lastRequestId?: string;
  lastErrorCode?: string;
  lastRetryable?: boolean;
  lastRetryAfterMs?: number;
};

function joinUrl(base: URL, apiPath: string, query?: Record<string, string | undefined>): URL {
  const basePath = base.pathname.endsWith("/")
    ? base.pathname.slice(0, -1)
    : base.pathname;
  const suffix = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const url = new URL(basePath + suffix, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  return url;
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const media = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return media === "application/json" || media.endsWith("+json");
}

async function readCappedText(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; oversized: boolean }> {
  // Prefer Content-Length when present.
  const cl = res.headers.get("content-length");
  if (cl) {
    const n = Number.parseInt(cl, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      return { text: "", oversized: true };
    }
  }

  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      return { text: "", oversized: true };
    }
    return { text, oversized: false };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      return { text: "", oversized: true };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder("utf-8").decode(merged), oversized: false };
}

export class EntitlementClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly diag: DiagnosticsState = {};

  constructor(options: EntitlementClientOptions) {
    if (!options.userAgent || options.userAgent.trim().length === 0) {
      throw new TypeError("userAgent is required");
    }
    this.baseUrl = new URL(options.baseUrl.toString());
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = options.userAgent;
  }

  diagnostics(): EntitlementClientDiagnostics {
    // Explicit allow-list — never spread raw state that could grow secrets.
    return {
      openApiSha256: OPENAPI_SHA256,
      lastOperationId: this.diag.lastOperationId,
      lastStatus: this.diag.lastStatus,
      lastRequestId: this.diag.lastRequestId,
      lastErrorCode: this.diag.lastErrorCode,
      lastRetryable: this.diag.lastRetryable,
      lastRetryAfterMs: this.diag.lastRetryAfterMs,
    };
  }

  async getWellKnownGrokdeskKeys(): Promise<getWellKnownGrokdeskKeysResponse> {
    return this.request("getWellKnownGrokdeskKeys");
  }

  async createActivationChallenge(
    body: createActivationChallengeRequest = {},
  ): Promise<createActivationChallengeResponse> {
    return this.request("createActivationChallenge", { body });
  }

  async createActivation(
    body: createActivationRequest,
  ): Promise<createActivationResponse> {
    return this.request("createActivation", { body });
  }

  async exchangeLegacyGd2(
    body: exchangeLegacyGd2Request,
  ): Promise<exchangeLegacyGd2Response> {
    return this.request("exchangeLegacyGd2", { body });
  }

  async createDeactivationChallenge(
    body: createDeactivationChallengeRequest,
  ): Promise<createDeactivationChallengeResponse> {
    return this.request("createDeactivationChallenge", { body });
  }

  async deleteCurrentActivation(
    body: deleteCurrentActivationRequest,
  ): Promise<deleteCurrentActivationResponse> {
    return this.request("deleteCurrentActivation", { body });
  }

  async createLeaseChallenge(
    body: createLeaseChallengeRequest,
  ): Promise<createLeaseChallengeResponse> {
    return this.request("createLeaseChallenge", { body });
  }

  async refreshLease(body: refreshLeaseRequest): Promise<refreshLeaseResponse> {
    return this.request("refreshLease", { body });
  }

  async getReleaseManifest(
    query: getReleaseManifestQuery = {},
  ): Promise<getReleaseManifestResponse> {
    return this.request("getReleaseManifest", {
      query: {
        channel: query.channel,
        target: query.target,
      },
    });
  }

  async resolveRelease(
    body: resolveReleaseRequest,
  ): Promise<resolveReleaseResponse> {
    return this.request("resolveRelease", { body });
  }

  async createDownloadGrant(
    body: createDownloadGrantRequest,
  ): Promise<createDownloadGrantResponse> {
    return this.request("createDownloadGrant", { body });
  }

  async redeemDownload(
    query: redeemDownloadQuery,
  ): Promise<redeemDownloadResponse> {
    return this.request("redeemDownload", {
      query: { grant: query.grant },
    });
  }

  async getHealthz(): Promise<getHealthzResponse> {
    return this.request("getHealthz");
  }

  async getReadyz(): Promise<getReadyzResponse> {
    return this.request("getReadyz");
  }

  private recordSuccess(operationId: PublicOperationId, status: number, requestId?: string) {
    this.diag.lastOperationId = operationId;
    this.diag.lastStatus = status;
    this.diag.lastRequestId = requestId;
    this.diag.lastErrorCode = undefined;
    this.diag.lastRetryable = undefined;
    this.diag.lastRetryAfterMs = undefined;
  }

  private recordError(operationId: PublicOperationId, err: EntitlementApiError) {
    this.diag.lastOperationId = operationId;
    this.diag.lastStatus = err.status;
    this.diag.lastRequestId = err.requestId;
    this.diag.lastErrorCode = err.code;
    this.diag.lastRetryable = err.retryable;
    this.diag.lastRetryAfterMs = err.retryAfterMs;
  }

  private async request<Op extends PublicOperationId>(
    operationId: Op,
    init?: {
      body?: unknown;
      query?: Record<string, string | undefined>;
    },
  ): Promise<import("./generated/api.js").OperationResponseMap[Op]> {
    const meta = OPERATIONS[operationId];
    const url = joinUrl(this.baseUrl, meta.path, init?.query);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };

    const hasBody = init?.body !== undefined && meta.method !== "GET";
    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: meta.method,
        headers,
        body: hasBody ? JSON.stringify(init!.body) : undefined,
        // Reject automatic redirect following; redeem handles 302 manually.
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (cause) {
      clearTimeout(timer);
      const err = transportUnavailable();
      this.recordError(operationId, err);
      // Do not attach cause message — may include URLs with grant tokens.
      void cause;
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const requestIdHeader =
      response.headers.get("x-request-id") ??
      response.headers.get("x-correlation-id");

    // Redirect handling
    if (response.status >= 300 && response.status < 400) {
      if (meta.allowsRedirect && response.status === 302) {
        const location = response.headers.get("location");
        if (!location) {
          const err = new EntitlementApiError(
            "service_unavailable",
            false,
            requestIdHeader ?? undefined,
            response.status,
          );
          this.recordError(operationId, err);
          throw err;
        }
        this.recordSuccess(operationId, response.status, requestIdHeader ?? undefined);
        return {
          redirect: true as const,
          location,
        } as unknown as import("./generated/api.js").OperationResponseMap[Op];
      }
      const err = new EntitlementApiError(
        "service_unavailable",
        false,
        requestIdHeader ?? undefined,
        response.status,
      );
      this.recordError(operationId, err);
      throw err;
    }

    const { text, oversized } = await readCappedText(response, MAX_BODY_BYTES);
    if (oversized) {
      const err = new EntitlementApiError(
        "service_unavailable",
        false,
        requestIdHeader ?? undefined,
        response.status,
      );
      this.recordError(operationId, err);
      throw err;
    }

    const contentType = response.headers.get("content-type");
    let parsed: unknown = undefined;
    if (text.length > 0) {
      if (!isJsonContentType(contentType) && response.ok) {
        const err = new EntitlementApiError(
          "service_unavailable",
          false,
          requestIdHeader ?? undefined,
          response.status,
        );
        this.recordError(operationId, err);
        throw err;
      }
      if (text.length > 0 && (isJsonContentType(contentType) || !response.ok)) {
        try {
          parsed = JSON.parse(text);
        } catch {
          const err = new EntitlementApiError(
            "service_unavailable",
            response.status >= 500 || response.status === 0,
            requestIdHeader ?? undefined,
            response.status,
          );
          this.recordError(operationId, err);
          throw err;
        }
      }
    }

    if (!response.ok) {
      const err = mapHttpError({
        status: response.status,
        body: parsed,
        requestIdHeader,
        retryAfterHeader: response.headers.get("retry-after"),
      });
      this.recordError(operationId, err);
      throw err;
    }

    // Empty success body
    if (parsed === undefined) {
      this.recordSuccess(
        operationId,
        response.status,
        requestIdHeader ?? undefined,
      );
      return undefined as unknown as import("./generated/api.js").OperationResponseMap[Op];
    }

    const bodyRequestId =
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { requestId?: unknown }).requestId === "string"
        ? (parsed as { requestId: string }).requestId
        : undefined;

    this.recordSuccess(
      operationId,
      response.status,
      bodyRequestId ?? requestIdHeader ?? undefined,
    );
    return parsed as import("./generated/api.js").OperationResponseMap[Op];
  }
}

export function createEntitlementClient(
  options: EntitlementClientOptions,
): EntitlementClient {
  return new EntitlementClient(options);
}
