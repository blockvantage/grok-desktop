import { DEFAULT_RELAY_URL as SHARED_DEFAULT_RELAY_URL } from "@grokdesk/shared";
import { getActiveIntlLocale, t } from "@/i18n/active";

export function formatDeviceLastSeen(iso: string | null | undefined): string {
  if (!iso) return t("settings.remote.never");
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return t("settings.remote.never");
  return new Date(parsed).toLocaleString(getActiveIntlLocale());
}

/** Relative last-seen for device list (e.g. "2m ago"). Falls back to absolute. */
export function formatDeviceLastSeenRelative(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!iso) return t("settings.remote.never");
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return t("settings.remote.never");
  const delta = Math.max(0, nowMs - parsed);
  const sec = Math.floor(delta / 1000);
  if (sec < 45) return t("settings.remote.justNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("settings.remote.minutesAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 48) return t("settings.remote.hoursAgo", { n: hr });
  return new Date(parsed).toLocaleString(getActiveIntlLocale());
}

export function isDeviceActive(device: { revokedAt?: string | null }): boolean {
  return !device.revokedAt;
}

/** Seconds remaining until pairing QR expires; 0 when expired. */
export function pairingSecondsRemaining(
  expiresAtMs: number | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (expiresAtMs == null || !Number.isFinite(expiresAtMs)) return 0;
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
}

export function formatPairingCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** Production default; local dev can set `ws://127.0.0.1:8787` in Settings. */
export const DEFAULT_RELAY_URL = SHARED_DEFAULT_RELAY_URL;

export function normalizeRelayUrlInput(raw: string): string {
  const v = raw.trim();
  if (!v) return DEFAULT_RELAY_URL;
  return v.replace(/\/$/, "");
}

/** Map ws(s)://host[:port][/relay][/v1] → http(s)://…/health (keeps path prefix). */
export function relayHealthUrl(relayWsUrl: string): string {
  const base = normalizeRelayUrlInput(relayWsUrl)
    .replace(/^ws:/i, "http:")
    .replace(/^wss:/i, "https:")
    .replace(/\/v1\/?$/i, "");
  return `${base.replace(/\/$/, "")}/health`;
}

export type RelayProbeResult =
  | { ok: true; url: string; peers?: number }
  | { ok: false; url: string; reason: string };

/**
 * Probe a candidate relay. Real Grok Desk relays report store stats
 * (`peers` / `channels` / `machines`). Other services on :8787 often return
 * a different health JSON — reject those so pairing cannot target the wrong process.
 */
export async function probeRelayHealth(
  relayWsUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayProbeResult> {
  const url = normalizeRelayUrlInput(relayWsUrl);
  const health = relayHealthUrl(url);
  try {
    const res = await fetchImpl(health, {
      method: "GET",
      // Avoid hanging settings UI when a candidate host is unreachable.
      signal:
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(4_000)
          : undefined,
    });
    if (!res.ok) {
      return { ok: false, url, reason: `HTTP ${res.status} from ${health}` };
    }
    const body = (await res.json()) as Record<string, unknown>;
    if (body.ok !== true) {
      return { ok: false, url, reason: "health.ok is not true" };
    }
    // Blind relay shape from services/remote-relay
    const looksLikeRelay =
      typeof body.peers === "number" ||
      typeof body.channels === "number" ||
      typeof body.machines === "number";
    if (!looksLikeRelay) {
      return {
        ok: false,
        url,
        reason:
          "service on this port is not the Grok Desk remote relay (wrong health payload)",
      };
    }
    return {
      ok: true,
      url,
      peers: typeof body.peers === "number" ? body.peers : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      url,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Prefer preferred URL; if not a real Grok Desk relay, try production then local. */
export async function resolveWorkingRelayUrl(
  preferred: string = DEFAULT_RELAY_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayProbeResult> {
  const candidates = [
    preferred,
    DEFAULT_RELAY_URL,
    // Local dev fallbacks — 8787 is often occupied by unrelated local APIs.
    "ws://127.0.0.1:8788",
    "ws://127.0.0.1:8789",
    "ws://127.0.0.1:8787",
    "ws://localhost:8788",
  ];
  const seen = new Set<string>();
  let last: RelayProbeResult | null = null;
  for (const c of candidates) {
    const n = normalizeRelayUrlInput(c);
    if (seen.has(n)) continue;
    seen.add(n);
    const r = await probeRelayHealth(n, fetchImpl);
    last = r;
    if (r.ok) return r;
  }
  return (
    last ?? {
      ok: false,
      url: preferred,
      reason: "no working relay found",
    }
  );
}
