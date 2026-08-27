import { describe, expect, it } from "vitest";
import { GROKDESK_VERSION } from "@grokdesk/shared";
import { grokAcpClientInfo } from "./client-info.js";

describe("grokAcpClientInfo", () => {
  it("uses the Desk app version, not a pinned 0.1.2 literal", () => {
    const info = grokAcpClientInfo();
    expect(info.name).toBe("grok-desk");
    expect(info.version).toBe(GROKDESK_VERSION);
    expect(info.version).not.toBe("0.1.2");
  });

  it("advertises x.ai/statusLine on initialize", async () => {
    const { grokAcpInitializeParams } = await import("./client-info.js");
    const params = grokAcpInitializeParams();
    expect(params._meta["x.ai/statusLine"]).toBe(true);
    expect(params.clientInfo.version).toBe(GROKDESK_VERSION);
  });
});
