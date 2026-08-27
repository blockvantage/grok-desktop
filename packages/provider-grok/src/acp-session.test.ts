import { describe, it, expect, afterEach } from "vitest";
import {
  MemoryLineDuplex,
  attachFakeAcpAgent,
} from "./acp-jsonrpc.js";
import { GrokAgentProvider } from "./provider.js";
import type { RuntimeEvent } from "@grokdesk/agent-runtime";
import { runProviderConformance } from "@grokdesk/agent-runtime";
import { AcpMediatedSession, createAcpBinding } from "./acp-session.js";
import type { EffectivePolicy } from "@grokdesk/agent-runtime";

describe("ACP mediated session (SEC-01 policy authorizer)", () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    // LIFO: cancel sessions before disposing the fake peer.
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  const balancedPolicy: EffectivePolicy = {
    version: "1",
    approvalMode: "balanced",
    workspaceRoots: ["/w"],
    capabilities: [{ id: "shell", decision: "allow" }],
  };

  it("denies shell tool when policy denies — tool does not execute", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, {
      requirePermission: true,
      permissionKind: "shell",
      permissionTitle: "Run shell",
    });
    cleanups.push(fake.dispose);

    const receipts: Array<{ decision: string; capabilityId: string }> = [];
    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: {
        version: "1",
        approvalMode: "strict",
        workspaceRoots: ["/w"],
        capabilities: [{ id: "shell", decision: "deny" }],
      },
      binding: createAcpBinding("grok-4.5"),
      onReceipt: (r) => receipts.push(r),
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");

    const events: RuntimeEvent[] = [];
    const result = await session.runTurn({ goal: "run ls" }, async (ev) => {
      events.push(ev);
      return "continue";
    });

    expect(result.status).toBe("done");
    expect(fake.state.toolsExecuted).toHaveLength(0);
    expect(fake.state.permissionOutcomes).toEqual(["deny"]);
    expect(receipts).toEqual([
      expect.objectContaining({
        decision: "deny",
        capabilityId: "shell",
      }),
    ]);
    expect(events.some((e) => e.type === "tool_call")).toBe(false);
  });

  it("resumes via session/resume and records the path", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b);
    cleanups.push(fake.dispose);
    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: balancedPolicy,
      binding: createAcpBinding("grok-4.5", "prior-sess"),
    });
    cleanups.push(() => session.cancel("test"));
    const path = await session.resumeFrom("prior-sess", "/w");
    expect(path).toBe("resume");
    expect(session.lastResumePath).toBe("resume");
    expect(session.binding.providerSessionId).toBe("prior-sess");
    expect(fake.state.requests.some((r) => r.method === "session/resume")).toBe(
      true,
    );
  });

  it("passes Desk MCP servers on session/new", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b);
    cleanups.push(fake.dispose);

    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: balancedPolicy,
      binding: createAcpBinding("grok-4.5"),
      mcpServers: [
        {
          id: "desk-browser",
          command: "node",
          args: ["browser.mjs"],
          env: { GROKDESK_BROWSER_TOKEN: "t" },
          enabled: true,
        },
      ],
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");

    const newSession = fake.state.requests.find((r) => r.method === "session/new");
    expect(newSession?.params).toEqual(
      expect.objectContaining({
        cwd: "/w",
        mcpServers: [
          {
            name: "desk-browser",
            command: "node",
            args: ["browser.mjs"],
            env: [{ name: "GROKDESK_BROWSER_TOKEN", value: "t" }],
          },
        ],
      }),
    );
  });

  it("allows shell tool when policy allows — tool executes", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, {
      requirePermission: true,
      permissionKind: "shell",
    });
    cleanups.push(fake.dispose);

    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: {
        version: "1",
        approvalMode: "balanced",
        workspaceRoots: ["/w"],
        capabilities: [{ id: "shell", decision: "allow" }],
      },
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");

    const events: RuntimeEvent[] = [];
    await session.runTurn({ goal: "run ls" }, async (ev) => {
      events.push(ev);
      return "continue";
    });

    expect(fake.state.toolsExecuted).toHaveLength(1);
    expect(fake.state.toolsExecuted[0]?.kind).toBe("shell");
    expect(fake.state.permissionOutcomes).toEqual(["allow"]);
    expect(events.some((e) => e.type === "tool_call")).toBe(true);
  });

  it("GrokAgentProvider acp mode creates mediated session via factory", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, { requirePermission: true });
    cleanups.push(fake.dispose);

    const p = new GrokAgentProvider({
      mode: "acp",
      failClosedOnUnenforceablePolicy: true,
      acpTransportFactory: () => duplex.a,
    });

    const caps = await p.getCapabilities("grok-4.5");
    expect(caps.toolMediation).toBe("provider-permission-rpc");
    expect(caps.policyEnforceable).toBe(true);

    const session = await p.createSession({
      ref: { providerId: "grok", modelId: "grok-4.5" },
      cwd: "/w",
      workspaceRoots: ["/w"],
      policy: {
        version: "1",
        approvalMode: "strict",
        workspaceRoots: ["/w"],
        capabilities: [{ id: "shell", decision: "deny" }],
      },
    });
    cleanups.push(() => session.cancel("test"));

    await session.runTurn({ goal: "rm -rf /" }, async () => "continue");
    expect(fake.state.toolsExecuted).toHaveLength(0);
  });

  it("ACP provider passes full conformance suite with fake agent", async () => {
    // Conformance uses balanced + ask shell; without requirePermission the
    // fake agent never requests permission, so turns complete cleanly.
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, { requirePermission: false });
    cleanups.push(fake.dispose);

    const p = new GrokAgentProvider({
      mode: "acp",
      failClosedOnUnenforceablePolicy: true,
      acpTransportFactory: () => duplex.a,
    });
    // Only one session can own the duplex client side — conformance creates
    // multiple sessions. Use a fresh duplex per createSession.
    const pMulti = new GrokAgentProvider({
      mode: "acp",
      failClosedOnUnenforceablePolicy: true,
      acpTransportFactory: () => {
        const d = new MemoryLineDuplex();
        const f = attachFakeAcpAgent(d.b, { requirePermission: false });
        cleanups.push(f.dispose);
        return d.a;
      },
    });

    const result = await runProviderConformance(pMulti);
    expect(result.failed).toEqual([]);
    expect(result.passed).toEqual(
      expect.arrayContaining([
        "probe",
        "listModels",
        "capabilities",
        "createSession_and_turn",
        "cancel",
      ]),
    );
  });

  it("requests plan session mode when the session starts planFirst", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, { requirePermission: false });
    cleanups.push(fake.dispose);
    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: balancedPolicy,
      binding: createAcpBinding("grok-4.5"),
      planFirst: true,
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w", { planFirst: true });
    expect(fake.state.requests.map((r) => r.method)).toContain(
      "session/set_mode",
    );
    const req = fake.state.requests.find((r) => r.method === "session/set_mode");
    expect(req?.params).toMatchObject({ modeId: "plan" });
  });

  it("interjects via x.ai/session/interjection, falling back to x.ai/interject", async () => {
    let tried = 0;
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, {
      requirePermission: false,
      respond: (method) => {
        if (method === "initialize") {
          return {
            protocolVersion: 1,
            serverInfo: { name: "fake" },
            capabilities: {},
          };
        }
        if (method === "session/new") return { sessionId: "s1" };
        if (method === "x.ai/session/interjection") {
          tried++;
          throw { code: -32601, message: "method not found" };
        }
        if (method === "x.ai/interject") {
          tried++;
          return {};
        }
        if (method === "session/cancel") return { ok: true };
        throw { code: -32601, message: "method not found" };
      },
    });
    cleanups.push(fake.dispose);
    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: balancedPolicy,
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");
    await expect(session.interject("also check errors")).resolves.toBe(true);
    const methods = fake.state.requests
      .map((r) => r.method)
      .filter((m) => m.includes("interject"));
    expect(methods).toEqual([
      "x.ai/session/interjection",
      "x.ai/interject",
    ]);
    expect(tried).toBe(2);
  });

  it("returns false when no interjection ext is supported", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, { requirePermission: false });
    cleanups.push(fake.dispose);
    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: balancedPolicy,
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");
    await expect(session.interject("hi")).resolves.toBe(false);
  });

  it("includes clientMutationId on interject params for reload dedupe", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, {
      requirePermission: false,
      respond: (method) => {
        if (method === "initialize") {
          return {
            protocolVersion: 1,
            serverInfo: { name: "fake" },
            capabilities: {},
          };
        }
        if (method === "session/new") return { sessionId: "s1" };
        if (method === "x.ai/session/interjection") return { ok: true };
        if (method === "session/cancel") return { ok: true };
        throw { code: -32601, message: "method not found" };
      },
    });
    cleanups.push(fake.dispose);
    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: balancedPolicy,
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");
    await expect(
      session.interject("also check errors", {
        clientMutationId: "q-mutation-42",
      }),
    ).resolves.toBe(true);
    const interjectReq = fake.state.requests.find(
      (r) => r.method === "x.ai/session/interjection",
    );
    expect(interjectReq?.params).toMatchObject({
      text: "also check errors",
      clientMutationId: "q-mutation-42",
      mutationId: "q-mutation-42",
    });
  });

  it("does not report delivered when the interject request throws non-method-not-found", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, {
      requirePermission: false,
      respond: (method) => {
        if (method === "initialize") {
          return {
            protocolVersion: 1,
            serverInfo: { name: "fake" },
            capabilities: {},
          };
        }
        if (method === "session/new") return { sessionId: "s1" };
        if (method === "x.ai/session/interjection") {
          throw { code: -32000, message: "provider busy" };
        }
        if (method === "session/cancel") return { ok: true };
        throw { code: -32601, message: "method not found" };
      },
    });
    cleanups.push(fake.dispose);
    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: balancedPolicy,
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");
    await expect(
      session.interject("hi", { clientMutationId: "m-1" }),
    ).rejects.toBeTruthy();
  });

  it("rewindPoints encodes observed CLI shape (prompt_index)", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, {
      requirePermission: false,
      respond: (method) => {
        if (method === "initialize") {
          return { protocolVersion: 1, serverInfo: { name: "fake" } };
        }
        if (method === "session/new") return { sessionId: "s1" };
        if (method === "x.ai/rewind/points") {
          return {
            rewind_points: [
              {
                prompt_index: 0,
                created_at: "2026-01-01T00:00:00Z",
                num_file_snapshots: 1,
                has_file_changes: true,
                prompt_preview: "first",
              },
            ],
          };
        }
        if (method === "session/cancel") return { ok: true };
        throw { code: -32601, message: "method not found" };
      },
    });
    cleanups.push(fake.dispose);
    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: balancedPolicy,
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");
    const points = await session.rewindPoints();
    expect(points).toEqual([
      {
        id: "0",
        label: "first",
        hasFileChanges: true,
        files: undefined,
      },
    ]);
  });

  it("ask mode with human allow_once executes tool", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, { requirePermission: true });
    cleanups.push(fake.dispose);

    const policy: EffectivePolicy = {
      version: "1",
      approvalMode: "balanced",
      workspaceRoots: ["/w"],
      capabilities: [{ id: "shell", decision: "ask" }],
    };
    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy,
      binding: createAcpBinding("grok-4.5"),
      onAsk: async () => "allow_once" as const,
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");
    await session.runTurn({ goal: "ls" }, async () => "continue");
    expect(fake.state.toolsExecuted).toHaveLength(1);
    expect(fake.state.permissionOutcomes).toEqual(["allow_once"]);
  });
});
