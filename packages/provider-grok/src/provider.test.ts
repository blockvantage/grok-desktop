import { describe, it, expect } from "vitest";
import { GrokAgentProvider } from "./provider.js";
import { GROK_HEADLESS_CAPABILITIES } from "./capabilities.js";
import { runProviderConformance } from "@grokdesk/agent-runtime";

describe("provider-grok", () => {
  it("exposes uncontrolled headless capabilities honestly", async () => {
    const p = new GrokAgentProvider();
    const caps = await p.getCapabilities("grok-4.5");
    expect(caps.toolMediation).toBe("uncontrolled");
    expect(caps.policyEnforceable).toBe(false);
    expect(caps).toMatchObject(GROK_HEADLESS_CAPABILITIES);
  });

  it("reports headless mode unavailable and advertises no runnable models", async () => {
    const p = new GrokAgentProvider();
    await expect(p.probe()).resolves.toMatchObject({
      ok: false,
      providerId: "grok",
      version: "headless-degraded",
    });
    await expect(p.listModels()).resolves.toEqual([]);
  });

  it("listModels returns injected catalog when ACP is available", async () => {
    const p = new GrokAgentProvider({
      mode: "acp",
      acpTransportFactory: () => ({
        writeLine() {},
        onLine: () => () => {},
        close: async () => {},
      }),
      models: async () => [
        {
          id: "live-model",
          displayName: "Live Model",
          providerId: "grok",
          modalities: ["text"],
        },
      ],
    });
    await expect(p.listModels()).resolves.toEqual([
      {
        id: "live-model",
        displayName: "Live Model",
        providerId: "grok",
        modalities: ["text"],
      },
    ]);
  });

  it("listModels falls back when models source throws", async () => {
    const p = new GrokAgentProvider({
      mode: "acp",
      acpTransportFactory: () => ({
        writeLine() {},
        onLine: () => () => {},
        close: async () => {},
      }),
      models: async () => {
        throw new Error("auth offline");
      },
    });
    const models = await p.listModels();
    expect(models.map((m) => m.id)).toContain("grok-4.5");
  });

  it("fails closed when policy requires mediation", async () => {
    const p = new GrokAgentProvider({ failClosedOnUnenforceablePolicy: true });
    await expect(
      p.createSession({
        ref: { providerId: "grok", modelId: "grok-4.5" },
        cwd: "/tmp",
        workspaceRoots: ["/tmp"],
        policy: {
          version: "1",
          approvalMode: "strict",
          workspaceRoots: ["/tmp"],
          capabilities: [{ id: "shell", decision: "deny" }],
        },
      }),
    ).rejects.toThrow(/cannot enforce|uncontrolled/i);
  });

  it("headless mode never simulates a successful customer turn", async () => {
    const p = new GrokAgentProvider({ failClosedOnUnenforceablePolicy: true });
    // balanced with only allow caps does not need mediation
    const session = await p.createSession({
      ref: { providerId: "grok", modelId: "grok-4.5" },
      cwd: "/tmp",
      workspaceRoots: ["/tmp"],
      policy: {
        version: "1",
        approvalMode: "balanced",
        workspaceRoots: ["/tmp"],
        capabilities: [{ id: "network", decision: "allow" }],
      },
    });
    const events: unknown[] = [];
    await expect(
      session.runTurn({ goal: "hello" }, async (event) => {
        events.push(event);
        return "continue";
      }),
    ).rejects.toThrow(/managed_runtime_unavailable|provider_unavailable/);
    expect(events).toEqual([]);
  });

  it("conformance suite reports unavailable headless paths honestly", async () => {
    const p = new GrokAgentProvider({ failClosedOnUnenforceablePolicy: true });
    const result = await runProviderConformance(p);
    const failed = result.failed.map((entry) => entry.name);
    expect(failed).toContain("probe");
    expect(failed).toContain("listModels");
    expect(result.passed).not.toContain("probe");
    expect(result.passed).not.toContain("listModels");
  });
});
