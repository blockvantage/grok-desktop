import { describe, expect, it } from "vitest";
import { GROKDESK_VERSION } from "@grokdesk/shared";
import { fetchUsageSnapshot } from "./billing-client.js";

describe("client version header (0.7)", () => {
  it("sends the Desk app version, not pinned 0.2.93", async () => {
    let header = "";
    await fetchUsageSnapshot("tok", {
      fetchImpl: async (_url, init) => {
        header = init.headers["x-grok-client-version"] ?? "";
        return {
          ok: true,
          status: 200,
          json: async () => ({
            config: { creditUsagePercent: 1 },
          }),
        };
      },
    });
    expect(header).toBe(GROKDESK_VERSION);
    expect(header).not.toBe("0.2.93");
  });
});
