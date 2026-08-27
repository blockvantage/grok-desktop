import { describe, expect, it } from "vitest";
import { parseAcpInitializeCapabilities } from "./acp-capabilities.js";

describe("parseAcpInitializeCapabilities", () => {
  it("reads sessionCapabilities, hooks, toolOverrides, statusLine, commands", () => {
    const table = parseAcpInitializeCapabilities({
      protocolVersion: 1,
      agentVersion: "1.0.5",
      sessionCapabilities: {
        close: true,
        list: true,
        resume: true,
        load: false,
      },
      capabilities: { loadSession: true },
      availableCommands: ["compact", "rewind", 12 as unknown as string],
      _meta: {
        "x.ai/hooks": {
          blockingEvents: true,
          decisions: true,
          stopSignals: false,
        },
        "x.ai/capabilities": { toolOverrides: true },
        "x.ai/statusLine": true,
        "x.ai/brandNew": { ignored: true },
      },
    });
    expect(table).toEqual({
      agentVersion: "1.0.5",
      sessionCapabilities: {
        close: true,
        list: true,
        resume: true,
        load: true,
      },
      hooks: {
        blockingEvents: true,
        decisions: true,
        stopSignals: false,
      },
      toolOverrides: true,
      statusLine: true,
      availableCommands: ["compact", "rewind"],
    });
  });

  it("fails closed on missing initialize (never assumes true)", () => {
    expect(parseAcpInitializeCapabilities(null)).toEqual({
      agentVersion: null,
      sessionCapabilities: {
        close: false,
        list: false,
        resume: false,
        load: false,
      },
      hooks: null,
      toolOverrides: false,
      statusLine: false,
      availableCommands: [],
    });
  });
});
