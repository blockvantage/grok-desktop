import { describe, expect, it } from "vitest";
import { pickNextConnector } from "./connector-next";

const catalog = [
  { id: "filesystem", name: "Filesystem", recommended: true },
  { id: "fetch", name: "Fetch", recommended: true },
  {
    id: "brave-search",
    name: "Brave Search",
    needsCredentials: true,
    recommended: true,
  },
  { id: "slack", name: "Slack", needsCredentials: true },
];

describe("connector-next", () => {
  it("prefers first free essential not yet enabled", () => {
    const next = pickNextConnector({
      catalog,
      enabledIds: ["filesystem"],
    });
    expect(next?.presetId).toBe("fetch");
    expect(next?.needsCredentials).toBe(false);
  });

  it("returns null when everything is enabled", () => {
    expect(
      pickNextConnector({
        catalog,
        enabledIds: catalog.map((c) => c.id),
      }),
    ).toBeNull();
  });

  it("can recommend credentialed connector when only those remain", () => {
    const next = pickNextConnector({
      catalog,
      enabledIds: ["filesystem", "fetch"],
    });
    expect(next?.presetId).toBe("brave-search");
    expect(next?.needsCredentials).toBe(true);
  });
});
