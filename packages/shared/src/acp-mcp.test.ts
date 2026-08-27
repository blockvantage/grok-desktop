import { describe, expect, it } from "vitest";
import { toAcpMcpServers } from "./acp-mcp.js";

describe("toAcpMcpServers", () => {
  it("maps enabled Desk servers into ACP session/new params", () => {
    expect(
      toAcpMcpServers([
        {
          id: "desk-browser",
          command: "node",
          args: ["browser.mjs"],
          env: { GROKDESK_BROWSER_TOKEN: "t" },
          enabled: true,
        },
        {
          id: "off",
          command: "node",
          args: ["x.mjs"],
          enabled: false,
        },
      ]),
    ).toEqual([
      {
        name: "desk-browser",
        command: "node",
        args: ["browser.mjs"],
        env: [{ name: "GROKDESK_BROWSER_TOKEN", value: "t" }],
      },
    ]);
  });

  it("skips incomplete records and treats missing enabled as on", () => {
    expect(
      toAcpMcpServers([
        { id: "", command: "node" },
        { id: "fs", command: "" },
        { id: "fs", command: "npx", args: ["-y", "mcp"] },
      ]),
    ).toEqual([
      {
        name: "fs",
        command: "npx",
        args: ["-y", "mcp"],
        env: [],
      },
    ]);
  });
});
