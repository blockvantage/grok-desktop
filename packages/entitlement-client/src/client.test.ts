import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  EntitlementClient,
  DEFAULT_TIMEOUT_MS,
  MAX_BODY_BYTES,
  EntitlementApiError,
  OPENAPI_SHA256,
  REQUIRED_OPERATION_IDS,
  OPERATIONS,
} from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(
    path.join(__dirname, "../testdata/http-fixtures.json"),
    "utf8",
  ),
) as {
  deviceRequest: { deskVersion: string; platform: string; arch: string };
  activationChallengeResponse: {
    challengeId: string;
    nonce: string;
    expiresAt: string;
    serverTime: string;
  };
  productKeyCanary: string;
  errors: Record<
    string,
    { code: string; message: string; requestId: string }
  >;
};

const BASE = new URL("https://entitlements.example.invalid/");

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function makeClient(fetchImpl: typeof fetch, timeoutMs?: number) {
  return new EntitlementClient({
    baseUrl: BASE,
    fetch: fetchImpl,
    userAgent: "GrokDesk-Test/0.0.0",
    timeoutMs,
  });
}

describe("generated OpenAPI surface", () => {
  it("embeds OpenAPI SHA-256 matching the checked-in snapshot", () => {
    expect(OPENAPI_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(OPENAPI_SHA256).toBe(
      "c14445afe743dff10eacded303f224ce91f87f6afa6031d5c3d10aeca515137d",
    );
  });

  it("includes all required public operationIds", () => {
    for (const id of [
      "getWellKnownGrokdeskKeys",
      "createActivationChallenge",
      "createActivation",
      "exchangeLegacyGd2",
      "createDeactivationChallenge",
      "deleteCurrentActivation",
      "createLeaseChallenge",
      "refreshLease",
      "getReleaseManifest",
      "resolveRelease",
      "createDownloadGrant",
      "redeemDownload",
      "getHealthz",
      "getReadyz",
    ] as const) {
      expect(REQUIRED_OPERATION_IDS).toContain(id);
      expect(OPERATIONS[id].path).toMatch(/^\//);
    }
  });
});

describe("EntitlementClient transport", () => {
  it("maps 503 to service_unavailable retryable and redacts product keys from diagnostics", async () => {
    const productKey = fixtures.productKeyCanary;
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, fixtures.errors.serviceUnavailable, {
        "x-request-id": fixtures.errors.serviceUnavailable.requestId,
      }),
    );
    const client = makeClient(fetchImpl);

    // Call with a canary product key in body path (activation).
    await expect(
      client.createActivation({
        productKey,
        challengeId: "11111111-1111-4111-8111-111111111111",
        deviceId: "22222222-2222-4222-8222-222222222222",
        devicePublicJwk: { kty: "OKP", crv: "Ed25519", x: "abc" },
        deviceName: "test",
        platform: "darwin",
        arch: "arm64",
        osVersion: "15.0",
        deskVersion: "0.1.0",
        signature: "sig",
      }),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      retryable: true,
    });

    // Also exercise challenge path from the plan snippet.
    fetchImpl.mockImplementationOnce(async () =>
      jsonResponse(503, fixtures.errors.serviceUnavailable),
    );
    await expect(
      client.createActivationChallenge(fixtures.deviceRequest),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      retryable: true,
    });

    expect(JSON.stringify(client.diagnostics())).not.toContain("GD3.");
    expect(JSON.stringify(client.diagnostics())).not.toContain(productKey);
    expect(client.diagnostics().lastErrorCode).toBe("service_unavailable");
    expect(client.diagnostics().lastRetryable).toBe(true);
  });

  it("preserves a stable fulfillment_pending code on retryable 503 responses", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, {
        code: "fulfillment_pending",
        message: "Purchase fulfillment is still processing",
        requestId: "req_pending_001",
      }),
    );
    const client = makeClient(fetchImpl);

    await expect(
      client.createActivationChallenge(fixtures.deviceRequest),
    ).rejects.toMatchObject({
      code: "fulfillment_pending",
      retryable: true,
      requestId: "req_pending_001",
    });
    expect(client.diagnostics().lastErrorCode).toBe("fulfillment_pending");
  });

  it("rejects invalid JSON without leaking body fragments into diagnostics", async () => {
    const bad = `{"not":"json"${fixtures.productKeyCanary}`;
    const fetchImpl = vi.fn(
      async () =>
        new Response(bad, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = makeClient(fetchImpl);

    await expect(
      client.createActivationChallenge(fixtures.deviceRequest),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      retryable: false,
    });

    const diag = JSON.stringify(client.diagnostics());
    expect(diag).not.toContain("GD3.");
    expect(diag).not.toContain(fixtures.productKeyCanary);
    expect(diag).not.toContain(bad);
  });

  it("rejects oversized responses above 64 KiB", async () => {
    const huge = "x".repeat(MAX_BODY_BYTES + 1);
    const fetchImpl = vi.fn(
      async () =>
        new Response(huge, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": String(huge.length),
          },
        }),
    );
    const client = makeClient(fetchImpl);

    await expect(client.getHealthz()).rejects.toMatchObject({
      code: "service_unavailable",
      retryable: false,
    });
  });

  it("treats 429 as retryable and surfaces Retry-After without body leakage", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        429,
        {
          code: "service_unavailable",
          message: `rate limited for ${fixtures.productKeyCanary}`,
          requestId: "req_rate_001",
        },
        {
          "retry-after": "12",
          "x-request-id": "req_rate_001",
        },
      ),
    );
    const client = makeClient(fetchImpl);

    let caught: unknown;
    try {
      await client.createLeaseChallenge({
        activationId: "11111111-1111-4111-8111-111111111111",
        deviceId: "22222222-2222-4222-8222-222222222222",
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(EntitlementApiError);
    const err = caught as EntitlementApiError;
    expect(err.code).toBe("service_unavailable");
    expect(err.retryable).toBe(true);
    expect(err.requestId).toBe("req_rate_001");
    expect(err.retryAfterMs).toBe(12_000);
    expect(err.message).toBe("service_unavailable");
    expect(err.message).not.toContain("GD3.");
    expect(JSON.stringify(err)).not.toContain("GD3.");
    expect(JSON.stringify(client.diagnostics())).not.toContain("GD3.");
    expect(client.diagnostics().lastRetryAfterMs).toBe(12_000);
  });

  it("maps 4xx authoritative denials as non-retryable stable codes", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, fixtures.errors.invalidKeyFormat, {
        "x-request-id": fixtures.errors.invalidKeyFormat.requestId,
      }),
    );
    const client = makeClient(fetchImpl);

    await expect(
      client.createActivation({
        productKey: fixtures.productKeyCanary,
        challengeId: "11111111-1111-4111-8111-111111111111",
        deviceId: "22222222-2222-4222-8222-222222222222",
        devicePublicJwk: { kty: "OKP", crv: "Ed25519", x: "abc" },
        deviceName: "test",
        platform: "darwin",
        arch: "arm64",
        osVersion: "15.0",
        deskVersion: "0.1.0",
        signature: "sig",
      }),
    ).rejects.toMatchObject({
      code: "invalid_key_format",
      retryable: false,
      requestId: fixtures.errors.invalidKeyFormat.requestId,
    });

    expect(JSON.stringify(client.diagnostics())).not.toContain("GD3.");
    expect(client.diagnostics().lastRequestId).toBe(
      fixtures.errors.invalidKeyFormat.requestId,
    );
  });

  it("maps seat_limit 409 as non-retryable", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, fixtures.errors.seatLimit),
    );
    const client = makeClient(fetchImpl);
    await expect(
      client.createActivation({
        productKey: fixtures.productKeyCanary,
        challengeId: "11111111-1111-4111-8111-111111111111",
        deviceId: "22222222-2222-4222-8222-222222222222",
        devicePublicJwk: { kty: "OKP", crv: "Ed25519", x: "abc" },
        deviceName: "test",
        platform: "darwin",
        arch: "arm64",
        osVersion: "15.0",
        deskVersion: "0.1.0",
        signature: "sig",
      }),
    ).rejects.toMatchObject({
      code: "seat_limit",
      retryable: false,
      requestId: fixtures.errors.seatLimit.requestId,
    });
  });

  it("maps 5xx without body to service_unavailable retryable", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("internal boom " + fixtures.productKeyCanary, {
          status: 500,
          headers: { "content-type": "text/plain", "x-request-id": "req_500" },
        }),
    );
    const client = makeClient(fetchImpl);
    await expect(
      client.createActivationChallenge(fixtures.deviceRequest),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      retryable: true,
      requestId: "req_500",
    });
    expect(JSON.stringify(client.diagnostics())).not.toContain("GD3.");
  });

  it("maps network/TLS failures and timeouts to service_unavailable retryable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed: certificate unknown");
    });
    const client = makeClient(fetchImpl);
    await expect(
      client.createActivationChallenge(fixtures.deviceRequest),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      retryable: true,
    });
  });

  it("aborts on timeout using the default 8s activation/refresh budget", async () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(8_000);
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const client = makeClient(fetchImpl, 25);

    await expect(
      client.createActivationChallenge(fixtures.deviceRequest),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("propagates request IDs from headers and error bodies", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(403, fixtures.errors.leaseExpired, {
        "x-request-id": "header-id-ignored-when-body-present",
      }),
    );
    const client = makeClient(fetchImpl);

    await expect(
      client.refreshLease({
        challengeId: "11111111-1111-4111-8111-111111111111",
        activationId: "11111111-1111-4111-8111-111111111111",
        deviceId: "22222222-2222-4222-8222-222222222222",
        priorLeaseJti: "jti",
        signature: "sig",
      }),
    ).rejects.toMatchObject({
      code: "lease_expired",
      retryable: false,
      requestId: fixtures.errors.leaseExpired.requestId,
    });
    expect(client.diagnostics().lastRequestId).toBe(
      fixtures.errors.leaseExpired.requestId,
    );
  });

  it("rejects unexpected redirects on non-redeem operations", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/phish" },
        }),
    );
    const client = makeClient(fetchImpl);
    await expect(
      client.createActivationChallenge(fixtures.deviceRequest),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      retryable: false,
      status: 302,
    });
  });

  it("allows 302 on redeemDownload and returns location without following", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "https://cdn.example/object?sig=1",
            "x-request-id": "req_redeem_302",
          },
        }),
    );
    const client = makeClient(fetchImpl);
    const result = await client.redeemDownload({ grant: "opaque-grant" });
    expect(result).toEqual({
      redirect: true,
      location: "https://cdn.example/object?sig=1",
    });
    expect(client.diagnostics().lastStatus).toBe(302);
    // grant token must not stick in diagnostics
    expect(JSON.stringify(client.diagnostics())).not.toContain("opaque-grant");
  });

  it("returns success JSON and records request id header", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://entitlements.example.invalid/v1/activations/challenges",
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "GrokDesk-Test/0.0.0",
      });
      return jsonResponse(200, fixtures.activationChallengeResponse, {
        "x-request-id": "req_ok_001",
      });
    });
    const client = makeClient(fetchImpl);
    const res = await client.createActivationChallenge(fixtures.deviceRequest);
    expect(res.challengeId).toBe(
      fixtures.activationChallengeResponse.challengeId,
    );
    expect(client.diagnostics().lastRequestId).toBe("req_ok_001");
    expect(client.diagnostics().lastErrorCode).toBeUndefined();
    expect(client.diagnostics().openApiSha256).toBe(OPENAPI_SHA256);
  });

  it("never puts error message body content into EntitlementApiError.message", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, {
        code: "invalid_key_format",
        message: `bad key ${fixtures.productKeyCanary}`,
        requestId: "req_msg",
      }),
    );
    const client = makeClient(fetchImpl);
    try {
      await client.createActivationChallenge(fixtures.deviceRequest);
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(EntitlementApiError);
      const err = e as EntitlementApiError;
      expect(err.message).toBe("invalid_key_format");
      expect(String(err)).not.toContain("GD3.");
      expect(JSON.stringify(err.toJSON())).not.toContain("GD3.");
    }
  });
});
