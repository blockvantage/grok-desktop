import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveWorkingRelayUrl } from "@/lib/remote-ui";

const here = dirname(fileURLToPath(import.meta.url));
const remoteTabSrc = readFileSync(join(here, "remote-tab.tsx"), "utf8");

describe("RemoteTab component wiring (H2)", () => {
  it("auto-switches dead preferred relay via resolveWorkingRelayUrl", async () => {
    const found = await resolveWorkingRelayUrl(
      "ws://127.0.0.1:8787",
      async (input) => {
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
      },
    );
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.url).toContain("8788");
  });

  it("ships auto-switch toast + backoff probe loop in the component source", () => {
    expect(remoteTabSrc).toMatch(/resolveWorkingRelayUrl/);
    expect(remoteTabSrc).toMatch(/relayAutoSwitched/);
    expect(remoteTabSrc).toMatch(/failRounds/);
    expect(remoteTabSrc).toMatch(/10_000/);
    expect(remoteTabSrc).toMatch(/setRelayUrl/);
  });

  it("masks pairing deep-link by default (pairSecret not shown in clear text)", () => {
    // QR still renders; the text field must not dump the full grokdesk://pair
    // payload until the user explicitly reveals it.
    expect(remoteTabSrc).toMatch(/qrRevealed/);
    expect(remoteTabSrc).toMatch(/data-pairing-link-masked/);
    expect(remoteTabSrc).toMatch(/showPairingLink|hidePairingLink/);
    expect(remoteTabSrc).toMatch(/••••/);
  });
});
