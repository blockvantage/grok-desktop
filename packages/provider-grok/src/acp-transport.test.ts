import { describe, it, expect } from "vitest";
import {
  AcpJsonRpcClient,
  MemoryLineDuplex,
  attachFakeAcpAgent,
} from "./acp-jsonrpc.js";

describe("ACP transport", () => {
  it("spawnAcpLineTransport fails closed without GROKDESK_ACP", async () => {
    const { spawnAcpLineTransport } = await import("./acp-transport.js");
    const prev = process.env.GROKDESK_ACP;
    delete process.env.GROKDESK_ACP;
    expect(() => spawnAcpLineTransport({ binary: "grok" })).toThrow(
      /not enabled|GROKDESK_ACP/i,
    );
    if (prev !== undefined) process.env.GROKDESK_ACP = prev;
  });

  it("allows an explicitly trusted managed runtime without ambient ACP", async () => {
    const { spawnAcpLineTransport } = await import("./acp-transport.js");
    const prev = process.env.GROKDESK_ACP;
    delete process.env.GROKDESK_ACP;
    try {
      const transport = spawnAcpLineTransport({
        binary: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        trustedManagedRuntime: true,
      });
      await transport.close();
    } finally {
      if (prev === undefined) delete process.env.GROKDESK_ACP;
      else process.env.GROKDESK_ACP = prev;
    }
  });

  it("end-to-end initialize+prompt via fake peer (no real CLI)", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b);
    const client = new AcpJsonRpcClient(duplex.a, { requestTimeoutMs: 2_000 });
    try {
      const init = await client.initialize();
      expect(init.protocolVersion).toBe(1);
      const { sessionId } = await client.newSession({ cwd: "/tmp" });
      const out = await client.prompt(sessionId, "hi");
      expect(out.stopReason).toBe("end_turn");
    } finally {
      await client.close();
      fake.dispose();
    }
  });
});
