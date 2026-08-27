/**
 * SuperGrok billing / usage client (Build /usage rails).
 *
 * Live endpoint (verified 2026-07-11 against signed-in SuperGrok session):
 *   GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
 *   Authorization: Bearer <access token from ~/.grok/auth.json>
 *
 * Response shape:
 *   { config: { creditUsagePercent, currentPeriod, productUsage[], onDemand*, prepaidBalance, ... } }
 *
 * Override base with GROKDESK_BILLING_BASE_URL (no trailing slash).
 */
import { GROKDESK_VERSION, type UsageSnapshot } from "@grokdesk/shared";

export const BILLING_MANAGE_URL = "https://grok.com/?_s=usage";

/** Default API host for credits (not the grok.com HTML site). */
export const DEFAULT_BILLING_BASE_URL = "https://cli-chat-proxy.grok.com";

export function defaultBillingBaseUrl(): string {
  return (
    process.env.GROKDESK_BILLING_BASE_URL?.replace(/\/$/, "") ||
    DEFAULT_BILLING_BASE_URL
  );
}

export function warnLevelFromPercent(
  p: number | null,
): UsageSnapshot["warnLevel"] {
  if (p == null || Number.isNaN(p)) return "none";
  if (p >= 90) return "hard";
  if (p >= 70) return "soft";
  return "none";
}

function asNum(raw: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Number(v);
    }
    // Nested money/amount: { val: number }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const val = (v as { val?: unknown }).val;
      if (typeof val === "number" && !Number.isNaN(val)) return val;
      if (typeof val === "string" && val.trim() !== "" && !Number.isNaN(Number(val))) {
        return Number(val);
      }
    }
  }
  return null;
}

function asStr(
  raw: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function asBool(
  raw: Record<string, unknown>,
  ...keys: string[]
): boolean | null {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "boolean") return v;
  }
  return null;
}

/** Unwrap live `{ config: {...} }` envelope when present. */
export function unwrapBillingBody(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const config = raw.config;
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }
  return raw;
}

/**
 * Prefer GrokBuild product usage % when productUsage[] is present;
 * else top-level creditUsagePercent.
 */
export function extractUsagePercent(cfg: Record<string, unknown>): number | null {
  const products = cfg.productUsage;
  if (Array.isArray(products)) {
    for (const p of products) {
      if (!p || typeof p !== "object") continue;
      const row = p as Record<string, unknown>;
      if (String(row.product ?? "") === "GrokBuild") {
        const pct = asNum(row, "usagePercent", "usage_percent");
        if (pct != null) return pct;
      }
    }
  }
  return asNum(cfg, "creditUsagePercent", "credit_usage_percent");
}

export function parseBillingCreditsResponse(
  raw: Record<string, unknown>,
  fetchedAt: string,
): UsageSnapshot {
  const cfg = unwrapBillingBody(raw);
  const creditUsagePercent = extractUsagePercent(cfg);

  // Period from currentPeriod or billingPeriod*
  let billingPeriodStart = asStr(
    cfg,
    "billingPeriodStart",
    "billing_period_start",
  );
  let billingPeriodEnd = asStr(cfg, "billingPeriodEnd", "billing_period_end");
  const period = cfg.currentPeriod;
  if (period && typeof period === "object" && !Array.isArray(period)) {
    const p = period as Record<string, unknown>;
    billingPeriodStart = billingPeriodStart ?? asStr(p, "start");
    billingPeriodEnd = billingPeriodEnd ?? asStr(p, "end");
  }

  return {
    fetchedAt,
    creditUsagePercent,
    includedUsed: asNum(cfg, "includedUsed", "included_used"),
    totalUsed: asNum(cfg, "totalUsed", "total_used"),
    monthlyLimit: asNum(cfg, "monthlyLimit", "monthly_limit"),
    onDemandEnabled: asBool(cfg, "onDemandEnabled", "on_demand_enabled"),
    onDemandUsed: asNum(cfg, "onDemandUsed", "on_demand_used"),
    onDemandCap: asNum(cfg, "onDemandCap", "on_demand_cap"),
    prepaidBalance: asNum(cfg, "prepaidBalance", "prepaid_balance"),
    subscriptionTier: asStr(cfg, "subscriptionTier", "subscription_tier"),
    billingPeriodStart,
    billingPeriodEnd,
    warnLevel: warnLevelFromPercent(creditUsagePercent),
    rawAvailable: true,
  };
}

export function unavailableUsageSnapshot(
  fetchedAt: string,
  reason?: string,
): UsageSnapshot {
  return {
    fetchedAt,
    creditUsagePercent: null,
    includedUsed: null,
    totalUsed: null,
    monthlyLimit: null,
    onDemandEnabled: null,
    onDemandUsed: null,
    onDemandCap: null,
    prepaidBalance: null,
    subscriptionTier: reason ? `error:${reason}` : null,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    warnLevel: "none",
    rawAvailable: false,
  };
}

export type BillingFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Fetch usage with SuperGrok bearer. Never logs the token.
 * Path: /v1/billing?format=credits on cli-chat-proxy (default).
 */
export async function fetchUsageSnapshot(
  accessToken: string,
  opts?: {
    fetchImpl?: BillingFetch;
    baseUrl?: string;
    now?: () => string;
    clientVersion?: string;
  },
): Promise<UsageSnapshot> {
  const fetchedAt = (opts?.now ?? (() => new Date().toISOString()))();
  if (!accessToken) {
    return unavailableUsageSnapshot(fetchedAt, "no_token");
  }
  const base = opts?.baseUrl ?? defaultBillingBaseUrl();
  const url = `${base}/v1/billing?format=credits`;
  const fetchImpl = opts?.fetchImpl ?? (globalThis.fetch as BillingFetch);
  try {
    const res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "x-grok-client-version": opts?.clientVersion ?? GROKDESK_VERSION,
      },
    });
    if (!res.ok) {
      return unavailableUsageSnapshot(fetchedAt, `http_${res.status}`);
    }
    const body = (await res.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") {
      return unavailableUsageSnapshot(fetchedAt, "bad_body");
    }
    // HTML splash pages look like success 200 — reject non-JSON-ish shapes
    if (typeof body.config !== "object" && body.creditUsagePercent == null) {
      // still try parse in case flat fixture
      const snap = parseBillingCreditsResponse(body, fetchedAt);
      if (snap.creditUsagePercent == null && !body.config) {
        return unavailableUsageSnapshot(fetchedAt, "html_or_unknown");
      }
      return snap;
    }
    return parseBillingCreditsResponse(body, fetchedAt);
  } catch {
    return unavailableUsageSnapshot(fetchedAt, "network");
  }
}
