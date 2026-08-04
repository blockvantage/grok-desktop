import { beforeEach, describe, expect, it } from "vitest";
import { setActiveLocale } from "@/i18n/active";
import {
  formatDeviceLastSeen,
  formatDeviceLastSeenRelative,
  formatPairingCountdown,
  isDeviceActive,
  normalizeRelayUrlInput,
  pairingSecondsRemaining,
  probeRelayHealth,
  relayHealthUrl,
  resolveWorkingRelayUrl,
} from "./remote-ui";

describe("remote-ui", () => {
  beforeEach(() => {
    setActiveLocale("en");
  });

  it("formats missing last seen", () => {
    expect(formatDeviceLastSeen(null)).toMatch(/never/i);
  });

  it("localizes never for non-English locales", () => {
    setActiveLocale("es");
    expect(formatDeviceLastSeen(null)).toBe("Nunca");
    setActiveLocale("de");
    expect(formatDeviceLastSeen(undefined)).toBe("Nie");
  });

  it("active when not revoked", () => {
    expect(isDeviceActive({ revokedAt: null })).toBe(true);
    expect(isDeviceActive({ revokedAt: "2026-01-01" })).toBe(false);
  });

  it("pairingSecondsRemaining clamps at zero", () => {
    const now = 1_000_000;
    expect(pairingSecondsRemaining(now + 30_000, now)).toBe(30);
    expect(pairingSecondsRemaining(now - 1000, now)).toBe(0);
    expect(pairingSecondsRemaining(null, now)).toBe(0);
  });

  it("formatPairingCountdown is m:ss", () => {
    expect(formatPairingCountdown(125)).toBe("2:05");
    expect(formatPairingCountdown(5)).toBe("0:05");
    expect(formatPairingCountdown(0)).toBe("0:00");
  });

  it("relative last seen for recent activity", () => {
    const now = Date.parse("2026-07-12T12:00:00Z");
    expect(
      formatDeviceLastSeenRelative(new Date(now - 10_000).toISOString(), now),
    ).toMatch(/just now/i);
    expect(
      formatDeviceLastSeenRelative(new Date(now - 5 * 60_000).toISOString(), now),
    ).toMatch(/5m/i);
  });

  it("normalizeRelayUrlInput trims trailing slash", () => {
    expect(normalizeRelayUrlInput("  ws://127.0.0.1:8787/  ")).toBe(
      "ws://127.0.0.1:8787",
    );
    expect(normalizeRelayUrlInput("")).toBe("wss://grokdesk.app/relay");
    expect(normalizeRelayUrlInput("wss://grokdesk.app/relay/")).toBe(
      "wss://grokdesk.app/relay",
    );
  });

  it("relayHealthUrl maps ws to http /health", () => {
    expect(relayHealthUrl("ws://127.0.0.1:8788/v1")).toBe(
      "http://127.0.0.1:8788/health",
    );
    expect(relayHealthUrl("ws://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787/health",
    );
    expect(relayHealthUrl("wss://grokdesk.app/relay")).toBe(
      "https://grokdesk.app/relay/health",
    );
    expect(relayHealthUrl("wss://grokdesk.app/relay/v1")).toBe(
      "https://grokdesk.app/relay/health",
    );
  });

  it("probeRelayHealth accepts real relay stats and rejects foreign health JSON", async () => {
    const good = await probeRelayHealth("ws://127.0.0.1:8788", async () =>
      new Response(JSON.stringify({ ok: true, peers: 0, channels: 0, machines: 0 }), {
        status: 200,
      }),
    );
    expect(good.ok).toBe(true);

    const foreign = await probeRelayHealth("ws://127.0.0.1:8787", async () =>
      new Response(
        JSON.stringify({
          ok: true,
          version: "0.1.0",
          fighter: "grok-3-latest",
          auth: "grok-session",
        }),
        { status: 200 },
      ),
    );
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.reason).toMatch(/not the Grok Desk remote relay/i);
    }
  });

  it("resolveWorkingRelayUrl falls through to a healthy alternate port", async () => {
    const r = await resolveWorkingRelayUrl("ws://127.0.0.1:8787", async (input) => {
      const u = String(input);
      if (u.includes(":8787")) {
        return new Response(
          JSON.stringify({ ok: true, fighter: "other" }),
          { status: 200 },
        );
      }
      if (u.includes(":8788")) {
        return new Response(
          JSON.stringify({ ok: true, peers: 1, channels: 0, machines: 1 }),
          { status: 200 },
        );
      }
      return new Response("nope", { status: 404 });
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toContain("8788");
  });
});
