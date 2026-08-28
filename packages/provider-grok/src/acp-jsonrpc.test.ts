import { describe, it, expect, afterEach } from "vitest";
import {
  ACP_MAX_LINE_BYTES,
  ACP_MAX_PENDING_RPC,
  AcpJsonRpcClient,
  MemoryLineDuplex,
  attachFakeAcpAgent,
  encodeJsonRpc,
  decodeJsonRpcLine,
} from "./acp-jsonrpc.js";

describe("ACP JSON-RPC framing", () => {
  const cleanups: Array<() => void> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) c();
  });

  it("round-trips encode/decode", () => {
    const line = encodeJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: 1 },
    });
    const msg = decodeJsonRpcLine(line);
    expect(msg).toMatchObject({ method: "initialize", id: 1 });
  });

  it("rejects oversized JSON-RPC lines before parse", () => {
    const huge = "x".repeat(ACP_MAX_LINE_BYTES + 1);
    expect(() => decodeJsonRpcLine(huge)).toThrow(/too large/i);
  });

  it("rejects new requests when pending RPC cap is reached", async () => {
    const duplex = new MemoryLineDuplex();
    // Peer never answers — fill pending waiters.
    const client = new AcpJsonRpcClient(duplex.a, {
      requestTimeoutMs: 5_000,
    });
    cleanups.push(() => {
      void client.close();
    });
    const inflight: Promise<unknown>[] = [];
    for (let i = 0; i < ACP_MAX_PENDING_RPC; i++) {
      inflight.push(client.request(`x/hold-${i}`, {}).catch(() => null));
    }
    await expect(client.request("x/overflow", {})).rejects.toThrow(
      /pending RPC cap/i,
    );
    await client.close();
    await Promise.allSettled(inflight);
  });

  it("negotiates initialize and creates a session against fake agent", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b);
    cleanups.push(fake.dispose);
    const client = new AcpJsonRpcClient(duplex.a, { requestTimeoutMs: 3_000 });
    cleanups.push(() => {
      void client.close();
    });

    const init = await client.initialize({ name: "test", version: "0" });
    expect(init.protocolVersion).toBe(1);
    expect(init.serverInfo?.name).toBe("fake-acp");

    const session = await client.newSession({ cwd: "/tmp" });
    expect(session.sessionId).toMatch(/^fake-sess-/);

    const prompt = await client.prompt(session.sessionId, "hello");
    expect(prompt.stopReason).toBe("end_turn");
  });

  it("handles server permission request mid-prompt and waits for decision", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, { requirePermission: true });
    cleanups.push(fake.dispose);
    let sawPermission = false;
    const client = new AcpJsonRpcClient(duplex.a, {
      requestTimeoutMs: 3_000,
      onServerRequest: (method, params, respond) => {
        if (method === "session/request_permission") {
          sawPermission = true;
          expect(params).toMatchObject({ kind: "shell" });
          respond({ outcome: "allow_once" });
          return;
        }
        respond(null);
      },
    });
    cleanups.push(() => {
      void client.close();
    });

    await client.initialize();
    const { sessionId } = await client.newSession();
    const prompt = await client.prompt(sessionId, "run ls");
    expect(sawPermission).toBe(true);
    expect(prompt).toMatchObject({
      stopReason: "end_turn",
      toolExecuted: true,
    });
    expect(fake.state.toolsExecuted).toHaveLength(1);
  });

  it("denied permission never executes tool on fake agent", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, { requirePermission: true });
    cleanups.push(fake.dispose);
    const client = new AcpJsonRpcClient(duplex.a, {
      requestTimeoutMs: 3_000,
      onServerRequest: (method, _params, respond) => {
        if (method === "session/request_permission") {
          respond({ outcome: "deny" });
          return;
        }
        respond(null);
      },
    });
    cleanups.push(() => {
      void client.close();
    });
    await client.initialize();
    const { sessionId } = await client.newSession();
    const prompt = await client.prompt(sessionId, "rm -rf /");
    expect(prompt).toMatchObject({ toolExecuted: false });
    expect(fake.state.toolsExecuted).toHaveLength(0);
    expect(fake.state.permissionOutcomes).toEqual(["deny"]);
  });

  it("times out missing responses", async () => {
    const duplex = new MemoryLineDuplex();
    // No agent attached — requests hang
    const client = new AcpJsonRpcClient(duplex.a, { requestTimeoutMs: 50 });
    cleanups.push(() => {
      void client.close();
    });
    await expect(client.request("initialize", {})).rejects.toThrow(/timeout/i);
  });

  it("session/new always sends mcpServers and prompt sends text ContentBlocks", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b);
    cleanups.push(fake.dispose);
    const seen: ReturnType<typeof decodeJsonRpcLine>[] = [];
    duplex.b.onLine((line) => {
      seen.push(decodeJsonRpcLine(line));
    });
    const client = new AcpJsonRpcClient(duplex.a, { requestTimeoutMs: 3_000 });
    cleanups.push(() => {
      void client.close();
    });

    await client.initialize();
    await client.newSession({ cwd: "/tmp" });
    const newReq = seen.find(
      (m) => "method" in m && m.method === "session/new",
    ) as { params?: { mcpServers?: unknown } } | undefined;
    expect(newReq?.params?.mcpServers).toEqual([]);

    await client.prompt("fake-sess-1", "hello");
    const promptReq = seen.find(
      (m) => "method" in m && m.method === "session/prompt",
    ) as { params?: { prompt?: unknown } } | undefined;
    expect(promptReq?.params?.prompt).toEqual([
      { type: "text", text: "hello" },
    ]);
  });
});
