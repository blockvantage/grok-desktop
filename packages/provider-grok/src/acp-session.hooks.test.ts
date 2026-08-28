import { describe, it, expect, afterEach } from "vitest";
import {
  AcpJsonRpcClient,
  MemoryLineDuplex,
  attachFakeAcpAgent,
} from "./acp-jsonrpc.js";
import { AcpMediatedSession, createAcpBinding } from "./acp-session.js";
import type { EffectivePolicy } from "@grokdesk/agent-runtime";
import type { RuntimeEvent } from "@grokdesk/agent-runtime";

describe("ACP client hooks (Phase 4.1)", () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  const denyShell: EffectivePolicy = {
    version: "1",
    approvalMode: "strict",
    workspaceRoots: ["/w"],
    capabilities: [{ id: "shell", decision: "deny" }],
  };

  const askShell: EffectivePolicy = {
    version: "1",
    approvalMode: "balanced",
    workspaceRoots: ["/w"],
    capabilities: [{ id: "shell", decision: "ask" }],
  };

  it("registers session/new hook groups only when initialize advertised hooks", async () => {
    const advertised = new MemoryLineDuplex();
    const fakeOn = attachFakeAcpAgent(advertised.b, { advertiseHooks: true });
    cleanups.push(fakeOn.dispose);
    const sessionOn = new AcpMediatedSession({
      transport: advertised.a,
      policy: denyShell,
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => sessionOn.cancel("test"));
    await sessionOn.start("/w");
    expect(sessionOn.capabilityTable?.hooks).toMatchObject({
      blockingEvents: true,
    });
    const createdOn = fakeOn.state.requests.find((r) => r.method === "session/new");
    expect(createdOn?.params).toMatchObject({
      _meta: {
        clientStatusLine: true,
        "x.ai/hooks": {
          groups: [
            expect.objectContaining({ events: ["PreToolUse"], blocking: true }),
            expect.objectContaining({ events: ["Stop"], blocking: false }),
          ],
        },
      },
    });

    const silent = new MemoryLineDuplex();
    const fakeOff = attachFakeAcpAgent(silent.b);
    cleanups.push(fakeOff.dispose);
    const sessionOff = new AcpMediatedSession({
      transport: silent.a,
      policy: denyShell,
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => sessionOff.cancel("test"));
    await sessionOff.start("/w");
    expect(sessionOff.capabilityTable?.hooks).toBeNull();
    const createdOff = fakeOff.state.requests.find(
      (r) => r.method === "session/new",
    );
    const meta = (createdOff?.params as { _meta?: Record<string, unknown> })
      ?._meta;
    expect(meta?.["x.ai/hooks"]).toBeUndefined();
  });

  it("PreToolUse deny blocks the tool; permission RPC is not required", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, {
      advertiseHooks: true,
      requireHook: true,
      hookToolName: "Bash",
      hookToolInput: { command: "rm -rf /" },
    });
    cleanups.push(fake.dispose);
    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: denyShell,
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");
    const events: RuntimeEvent[] = [];
    const result = await session.runTurn({ goal: "rm" }, async (ev) => {
      events.push(ev);
      return "continue";
    });
    expect(result.status).toBe("done");
    expect(fake.state.hookOutcomes).toEqual(["deny"]);
    expect(fake.state.toolsExecuted).toHaveLength(0);
    expect(session.hookLog).toEqual([
      expect.objectContaining({ decision: "deny" }),
    ]);
    expect(events.some((e) => e.type === "tool_call")).toBe(false);
  });

  it("needs_approval / unknown hook decisions fail open", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, {
      advertiseHooks: true,
      requireHook: true,
      hookToolName: "Bash",
      hookToolInput: { command: "curl http://example.test" },
    });
    cleanups.push(fake.dispose);
    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: askShell,
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");
    await session.runTurn({ goal: "curl" }, async () => "continue");
    expect(fake.state.hookOutcomes).toEqual(["allow"]);
    expect(fake.state.toolsExecuted).toHaveLength(1);
    expect(session.hookLog[0]?.decision).toBe("allow");
  });

  it("Stop hooks are observe-only and never deny", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, {
      advertiseHooks: true,
      requireHook: true,
      hookEventName: "Stop",
    });
    cleanups.push(fake.dispose);
    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: denyShell,
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");
    await session.runTurn({ goal: "done" }, async () => "continue");
    expect(fake.state.hookOutcomes).toEqual(["allow"]);
    expect(fake.state.toolsExecuted).toHaveLength(1);
  });

  it("agent fail-opens when hooks/run is method-not-found", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, {
      advertiseHooks: true,
      requireHook: true,
    });
    cleanups.push(fake.dispose);
    const client = new AcpJsonRpcClient(duplex.a, {
      requestTimeoutMs: 3_000,
      onServerRequest: (_method, _params, _respond, reject) => {
        reject(-32601, "Method not found");
      },
    });
    cleanups.push(() => client.close());
    await client.initialize();
    const created = await client.newSession({ cwd: "/w" });
    const result = await client.prompt(created.sessionId, "hi");
    expect(fake.state.hookOutcomes).toEqual(["allow"]);
    expect(fake.state.toolsExecuted).toHaveLength(1);
    expect(result).toMatchObject({ toolExecuted: true });
  });
});
