import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createDefaultProviderRegistry,
  deskPolicyToEffective,
  evaluateProviderPolicyGate,
} from "./provider-composition.js";
import { runProviderConformance } from "@grokdesk/agent-runtime";
import {
  MemoryLineDuplex,
  attachFakeAcpAgent,
} from "@grokdesk/provider-grok";

describe("provider composition root", () => {
  it("registers the fake provider for the explicit E2E engine contract", () => {
    const names = [
      "GROKDESK_E2E",
      "GROKDESK_PROVIDER_ENGINE",
      "GROKDESK_PROVIDER_ID",
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    process.env.GROKDESK_E2E = "1";
    process.env.GROKDESK_PROVIDER_ENGINE = "1";
    process.env.GROKDESK_PROVIDER_ID = "fake";
    try {
      expect(createDefaultProviderRegistry().require("fake").id).toBe("fake");
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("registers grok and echo at composition root", () => {
    const reg = createDefaultProviderRegistry();
    expect(reg.get("grok")?.id).toBe("grok");
    expect(reg.get("echo")?.id).toBe("echo");
    const ids = reg.list().map((p) => p.id);
    expect(ids).toContain("grok");
    expect(ids).toContain("echo");
  });

  it("echo passes conformance alongside fake when included", async () => {
    const reg = createDefaultProviderRegistry({ includeFake: true });
    const echo = reg.require("echo");
    const fake = reg.require("fake");
    const [echoResult, fakeResult] = await Promise.all([
      runProviderConformance(echo),
      runProviderConformance(fake),
    ]);
    expect(echoResult.failed).toEqual([]);
    expect(fakeResult.failed).toEqual([]);
  });

  it("defaults to headless-degraded without GROKDESK_ACP", async () => {
    const prev = process.env.GROKDESK_ACP;
    delete process.env.GROKDESK_ACP;
    const reg = createDefaultProviderRegistry();
    const health = await reg.require("grok").probe();
    expect(health.version).toBe("headless-degraded");
    if (prev !== undefined) process.env.GROKDESK_ACP = prev;
  });

  it("ignores ambient ACP and dev binaries in packaged composition", async () => {
    const names = [
      "GROKDESK_PACKAGED",
      "GROKDESK_ACP",
      "GROKDESK_DEV_GROK_BINARY",
      "GROKDESK_MANAGED_GROK_BINARY_RESOLVED",
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    process.env.GROKDESK_PACKAGED = "1";
    process.env.GROKDESK_ACP = "1";
    process.env.GROKDESK_DEV_GROK_BINARY = "/tmp/attacker-grok";
    process.env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED = "/managed/grok";
    try {
      const health = await createDefaultProviderRegistry()
        .require("grok")
        .probe();
      expect(health).toMatchObject({
        ok: false,
        version: "headless-degraded",
      });
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("builds explicit ACP only from the trusted resolved runtime", async () => {
    const names = [
      "GROKDESK_PACKAGED",
      "GROKDESK_ACP",
      "GROKDESK_DEV_GROK_BINARY",
      "GROKDESK_MANAGED_GROK_BINARY_RESOLVED",
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    process.env.GROKDESK_PACKAGED = "1";
    process.env.GROKDESK_ACP = "1";
    process.env.GROKDESK_DEV_GROK_BINARY = "/tmp/attacker-grok";
    process.env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED = "/managed/grok";
    try {
      const health = await createDefaultProviderRegistry({ preferAcp: true })
        .require("grok")
        .probe();
      expect(health).toMatchObject({ ok: true, version: "acp-mediated" });

      const source = readFileSync(
        fileURLToPath(new URL("./provider-composition.ts", import.meta.url)),
        "utf8",
      );
      expect(source).toContain("GROKDESK_MANAGED_GROK_BINARY_RESOLVED");
      expect(source).not.toMatch(/process\.env\.GROKDESK_DEV_GROK_BINARY/);
      expect(source).not.toMatch(
        /process\.env\.GROKDESK_MANAGED_GROK_BINARY(?:\W|$)/,
      );
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("requires provider health before gateway selects the provider engine", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/await provider\.probe\(\)/);
    expect(source).toMatch(/if \(!providerHealth\.ok\)/);
    expect(source.match(/await provider\.probe\(\)/g)).toHaveLength(2);
  });

  it("fake provider passes conformance when included", async () => {
    const reg = createDefaultProviderRegistry({ includeFake: true });
    const fake = reg.require("fake");
    const result = await runProviderConformance(fake);
    expect(result.failed).toEqual([]);
  });

  it("strict deny shell fails closed on uncontrolled grok caps", async () => {
    const reg = createDefaultProviderRegistry();
    const grok = reg.require("grok");
    const caps = await grok.getCapabilities("grok-4.5");
    const policy = deskPolicyToEffective({
      approvalMode: "strict",
      workspaceRoots: ["/w"],
      allowShell: false,
      allowNetworkTools: false,
    });
    const gate = evaluateProviderPolicyGate(caps, policy, {
      allowDegraded: false,
    });
    expect(gate.action).toBe("reject");
  });

  it("can explicitly allow degraded mode", async () => {
    const reg = createDefaultProviderRegistry();
    const caps = await reg.require("grok").getCapabilities("grok-4.5");
    const policy = deskPolicyToEffective({
      approvalMode: "strict",
      workspaceRoots: ["/w"],
      allowShell: false,
      allowNetworkTools: true,
    });
    const gate = evaluateProviderPolicyGate(caps, policy, {
      allowDegraded: true,
    });
    expect(gate.action).toBe("degraded");
  });

  it("ACP composition: deny shell does not execute tool (SEC-01)", async () => {
    const receipts: Array<{ decision: string; capabilityId: string }> = [];
    const reg = createDefaultProviderRegistry({
      preferAcp: true,
      acpTransportFactory: () => {
        const d = new MemoryLineDuplex();
        attachFakeAcpAgent(d.b, {
          requirePermission: true,
          permissionKind: "shell",
        });
        return d.a;
      },
      onAuthorizationReceipt: (r) => receipts.push(r),
    });
    const grok = reg.require("grok");
    const caps = await grok.getCapabilities("grok-4.5");
    expect(caps.toolMediation).toBe("provider-permission-rpc");
    expect(caps.policyEnforceable).toBe(true);

    const policy = deskPolicyToEffective({
      approvalMode: "strict",
      workspaceRoots: ["/w"],
      allowShell: false,
      allowNetworkTools: false,
    });
    const gate = evaluateProviderPolicyGate(caps, policy);
    expect(gate.action).toBe("proceed");

    const session = await grok.createSession({
      ref: { providerId: "grok", modelId: "grok-4.5" },
      cwd: "/w",
      workspaceRoots: ["/w"],
      policy,
    });
    await session.runTurn({ goal: "rm -rf /" }, async () => "continue");
    expect(receipts).toEqual([
      expect.objectContaining({ decision: "deny", capabilityId: "shell" }),
    ]);
    await session.cancel("test");
  });
});
