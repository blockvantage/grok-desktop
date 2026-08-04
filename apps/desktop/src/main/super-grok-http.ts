/**
 * Main-process SuperGrok rails: usage fetch.
 * Access tokens never leave this module toward renderer IPC results.
 *
 * Privacy/training preferences for SuperGrok are owned by xAI (self-serve on
 * grok.com). Desk does not host a privacy backend or pretend to sync policy.
 */
import type { PrivacyState, UsageSnapshot } from "@grokdesk/shared";
import {
  BILLING_MANAGE_URL,
  fetchUsageSnapshot,
  resolveManagedGrokBinary,
  probeModelsViaCli,
  readSuperGrokAccessToken,
  unavailableUsageSnapshot,
} from "@grokdesk/engine-grok";

let usageCache: { at: number; snap: UsageSnapshot } | null = null;
const USAGE_TTL_MS = 60_000;

/** Drop cached SuperGrok usage (call on sign-out so the UI cannot show a prior account). */
export function clearUsageCache(): void {
  usageCache = null;
}

/** SuperGrok account / billing (xAI). Not a Desk-owned service. */
export { BILLING_MANAGE_URL };

/** Account privacy & data controls on grok.com (self-serve SuperGrok). */
export const ACCOUNT_PRIVACY_URL = "https://grok.com/?_s=usage";

/**
 * Ensure we have a usable access token. If missing/empty, poke `grok models`
 * so the CLI refreshes auth.json, then re-read the token.
 */
async function resolveAccessToken(): Promise<string | null> {
  let tok = await readSuperGrokAccessToken();
  if (tok?.accessToken) return tok.accessToken;

  try {
    const binary = await resolveManagedGrokBinary();
    if (binary) {
      await probeModelsViaCli(binary);
      tok = await readSuperGrokAccessToken();
      if (tok?.accessToken) return tok.accessToken;
    }
  } catch {
    /* ignore refresh failures */
  }
  return tok?.accessToken || null;
}

export async function getUsageForUi(force = false): Promise<UsageSnapshot> {
  const now = Date.now();
  if (!force && usageCache && now - usageCache.at < USAGE_TTL_MS) {
    return usageCache.snap;
  }
  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    const snap = unavailableUsageSnapshot(
      new Date().toISOString(),
      "no_token",
    );
    usageCache = { at: now, snap };
    return snap;
  }
  let snap = await fetchUsageSnapshot(accessToken);
  if (
    !snap.rawAvailable &&
    String(snap.subscriptionTier ?? "").includes("http_401")
  ) {
    try {
      const binary = await resolveManagedGrokBinary();
      if (binary) {
        await probeModelsViaCli(binary);
        const again = await readSuperGrokAccessToken();
        if (again?.accessToken) {
          snap = await fetchUsageSnapshot(again.accessToken);
        }
      }
    } catch {
      /* keep first snap */
    }
  }
  usageCache = { at: now, snap };
  return snap;
}

/**
 * SuperGrok privacy is not stored or enforced by Desk.
 * Returns a static self-serve summary for Settings copy (no local fake toggle).
 */
export async function getPrivacyState(): Promise<PrivacyState> {
  return {
    codingDataSharing: null,
    summary: "",
    fetchedAt: new Date().toISOString(),
    localOnly: false,
  };
}

/** No-op: Desk does not own SuperGrok training/privacy settings. */
export async function setPrivacyState(
  _codingDataSharing: boolean,
): Promise<PrivacyState> {
  return getPrivacyState();
}
