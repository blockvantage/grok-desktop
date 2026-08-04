import { describe, expect, it } from "vitest";
import { UPDATE_MAIN_IPC_CHANNELS } from "./dto.js";

describe("UPDATE_MAIN_IPC_CHANNELS", () => {
  it("exposes main-only update channels (not gateway RPC)", () => {
    expect(UPDATE_MAIN_IPC_CHANNELS.status).toBe("grokdesk:update:status");
    expect(UPDATE_MAIN_IPC_CHANNELS.check).toBe("grokdesk:update:check");
    expect(UPDATE_MAIN_IPC_CHANNELS.installRestart).toBe(
      "grokdesk:update:install-restart",
    );
    expect(UPDATE_MAIN_IPC_CHANNELS.cancel).toBe("grokdesk:update:cancel");
    expect(UPDATE_MAIN_IPC_CHANNELS.statusChanged).toBe(
      "grokdesk:update:status-changed",
    );

    for (const channel of Object.values(UPDATE_MAIN_IPC_CHANNELS)) {
      expect(channel.startsWith("grokdesk:update:")).toBe(true);
      expect(channel).not.toMatch(/grant|private|productKey|lease|gd3|policy/i);
    }
  });

  it("does not expose security-policy mutation channels", () => {
    const values = Object.values(UPDATE_MAIN_IPC_CHANNELS);
    expect(values.some((c) => /security|policy|set|apply/i.test(c))).toBe(
      false,
    );
  });
});
