import { describe, expect, it } from "vitest";
import { ENTITLEMENT_MAIN_IPC_CHANNELS } from "./dto.js";

describe("ENTITLEMENT_MAIN_IPC_CHANNELS", () => {
  it("exposes main-only entitlement channels (not gateway license RPC)", () => {
    expect(ENTITLEMENT_MAIN_IPC_CHANNELS.status).toBe(
      "grokdesk:entitlement:status",
    );
    expect(ENTITLEMENT_MAIN_IPC_CHANNELS.activate).toBe(
      "grokdesk:entitlement:activate",
    );
    expect(ENTITLEMENT_MAIN_IPC_CHANNELS.deactivate).toBe(
      "grokdesk:entitlement:deactivate",
    );
    expect(ENTITLEMENT_MAIN_IPC_CHANNELS.refresh).toBe(
      "grokdesk:entitlement:refresh",
    );
    expect(ENTITLEMENT_MAIN_IPC_CHANNELS.statusChanged).toBe(
      "grokdesk:entitlement:status-changed",
    );

    for (const channel of Object.values(ENTITLEMENT_MAIN_IPC_CHANNELS)) {
      expect(channel.startsWith("grokdesk:entitlement:")).toBe(true);
      expect(channel).not.toContain("license.");
      expect(channel).not.toMatch(/private|productKey|lease|gd3/i);
    }
  });
});
