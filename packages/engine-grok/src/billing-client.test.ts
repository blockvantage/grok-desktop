import { describe, it, expect } from "vitest";
import {
  parseBillingCreditsResponse,
  warnLevelFromPercent,
  fetchUsageSnapshot,
  unavailableUsageSnapshot,
  BILLING_MANAGE_URL,
  DEFAULT_BILLING_BASE_URL,
  unwrapBillingBody,
  extractUsagePercent,
} from "./billing-client.js";

/** Live-shaped fixture (cli-chat-proxy.grok.com/v1/billing?format=credits). */
const LIVE_FIXTURE = {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-07-08T18:42:02.410700+00:00",
      end: "2026-07-15T18:42:02.410700+00:00",
    },
    creditUsagePercent: 57.0,
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    productUsage: [
      { product: "GrokBuild", usagePercent: 52.0 },
      { product: "Api", usagePercent: 5.0 },
      { product: "GrokChat" },
      { product: "GrokImagine" },
    ],
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 0 },
    billingPeriodStart: "2026-07-08T18:42:02.410700+00:00",
    billingPeriodEnd: "2026-07-15T18:42:02.410700+00:00",
  },
};

const FLAT_FIXTURE = {
  creditUsagePercent: 72,
  includedUsed: 720,
  totalUsed: 720,
  monthlyLimit: 1000,
  on_demand_enabled: false,
  onDemandUsed: 0,
  onDemandCap: null,
  prepaidBalance: 0,
  subscription_tier: "supergrok",
  billingPeriodStart: "2026-07-01",
  billingPeriodEnd: "2026-08-01",
};

describe("parseBillingCreditsResponse", () => {
  it("maps live config envelope + GrokBuild product percent", () => {
    const snap = parseBillingCreditsResponse(
      LIVE_FIXTURE as unknown as Record<string, unknown>,
      "2026-07-11T00:00:00.000Z",
    );
    expect(snap.rawAvailable).toBe(true);
    // Prefer GrokBuild product usage (52) over overall 57
    expect(snap.creditUsagePercent).toBe(52);
    expect(snap.warnLevel).toBe("none");
    expect(snap.onDemandCap).toBe(0);
    expect(snap.onDemandUsed).toBe(0);
    expect(snap.prepaidBalance).toBe(0);
    expect(snap.billingPeriodStart).toContain("2026-07-08");
    expect(snap.billingPeriodEnd).toContain("2026-07-15");
  });

  it("maps flat fixture", () => {
    const snap = parseBillingCreditsResponse(
      FLAT_FIXTURE as unknown as Record<string, unknown>,
      "2026-07-11T00:00:00.000Z",
    );
    expect(snap.creditUsagePercent).toBe(72);
    expect(snap.warnLevel).toBe("soft");
    expect(snap.subscriptionTier).toBe("supergrok");
  });
});

describe("unwrapBillingBody / extractUsagePercent", () => {
  it("unwraps config", () => {
    const cfg = unwrapBillingBody(
      LIVE_FIXTURE as unknown as Record<string, unknown>,
    );
    expect(cfg.creditUsagePercent).toBe(57);
  });
  it("prefers GrokBuild product", () => {
    const cfg = unwrapBillingBody(
      LIVE_FIXTURE as unknown as Record<string, unknown>,
    );
    expect(extractUsagePercent(cfg)).toBe(52);
  });
});

describe("warnLevelFromPercent", () => {
  it("thresholds", () => {
    expect(warnLevelFromPercent(10)).toBe("none");
    expect(warnLevelFromPercent(70)).toBe("soft");
    expect(warnLevelFromPercent(95)).toBe("hard");
    expect(warnLevelFromPercent(null)).toBe("none");
  });
});

describe("fetchUsageSnapshot", () => {
  it("hits /v1/billing on default base and parses live shape", async () => {
    let calledUrl = "";
    const snap = await fetchUsageSnapshot("tok", {
      fetchImpl: async (url) => {
        calledUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => LIVE_FIXTURE,
        };
      },
      now: () => "2026-07-11T12:00:00.000Z",
    });
    expect(calledUrl).toBe(
      `${DEFAULT_BILLING_BASE_URL}/v1/billing?format=credits`,
    );
    expect(snap.rawAvailable).toBe(true);
    expect(snap.creditUsagePercent).toBe(52);
  });

  it("returns unavailable with reason on HTTP error", async () => {
    const snap = await fetchUsageSnapshot("tok", {
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
      }),
    });
    expect(snap.rawAvailable).toBe(false);
    expect(snap.subscriptionTier).toBe("error:http_401");
  });

  it("rejects HTML-looking 200 bodies", async () => {
    const snap = await fetchUsageSnapshot("tok", {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ some: "html page props" }),
      }),
    });
    expect(snap.rawAvailable).toBe(false);
  });

  it("returns unavailable without token", async () => {
    const snap = await fetchUsageSnapshot("");
    expect(snap.rawAvailable).toBe(false);
  });
});

describe("BILLING_MANAGE_URL", () => {
  it("points at grok.com usage", () => {
    expect(BILLING_MANAGE_URL).toContain("grok.com");
    expect(BILLING_MANAGE_URL).toContain("usage");
  });
});

describe("unavailableUsageSnapshot", () => {
  it("marks rawAvailable false", () => {
    expect(unavailableUsageSnapshot("t").rawAvailable).toBe(false);
  });
});
