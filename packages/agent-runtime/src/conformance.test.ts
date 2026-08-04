import { describe, it, expect } from "vitest";
import path from "node:path";
import { FakeAgentProvider } from "./fake-provider.js";
import { runProviderConformance } from "./conformance.js";
import { ProviderRegistry } from "./registry.js";
import { assertPolicyCompatible } from "./provider.js";
import type { ProviderCapabilities, EffectivePolicy } from "./types.js";

describe("agent-runtime conformance (fake provider)", () => {
  it("fake provider passes the full conformance suite", async () => {
    const provider = new FakeAgentProvider();
    const result = await runProviderConformance(provider);
    expect(result.failed).toEqual([]);
    expect(result.passed.length).toBeGreaterThanOrEqual(5);
  });

  it("fake provider requests a deterministic artifact inside its session workspace", async () => {
    const provider = new FakeAgentProvider();
    const session = await provider.createSession({
      ref: { providerId: "fake", modelId: "fake-fast" },
      cwd: "/demo/workspace",
      workspaceRoots: ["/demo/workspace"],
      policy: {
        version: "1",
        approvalMode: "strict",
        workspaceRoots: ["/demo/workspace"],
        capabilities: [{ id: "shell", decision: "ask" }],
      },
    });
    const events: Array<{ type: string; path?: string; meta?: Record<string, unknown> }> = [];
    await session.runTurn({ goal: "Prepare the launch brief" }, async (event) => {
      events.push(event);
      return "continue";
    });

    expect(events.find((event) => event.type === "permission_request")).toMatchObject({
      path: path.join("/demo/workspace", "grokdesk-demo-report.md"),
      meta: { content: expect.stringContaining("Prepare the launch brief") },
    });
    expect(events.find((event) => event.type === "artifact")).toMatchObject({
      path: path.join("/demo/workspace", "grokdesk-demo-report.md"),
    });
    expect(JSON.stringify(events)).not.toMatch(/fake (?:turn|done|wrote)/i);
  });

  it("registry registers and lists providers", async () => {
    const reg = new ProviderRegistry();
    reg.register(new FakeAgentProvider());
    expect(reg.list().map((p) => p.id)).toEqual(["fake"]);
    const models = await reg.listAllModels();
    expect(models.some((m) => m.id === "fake-fast")).toBe(true);
  });

  it("assertPolicyCompatible fails closed for uncontrolled + strict", () => {
    const caps: ProviderCapabilities = {
      sessions: "none",
      toolMediation: "uncontrolled",
      sandboxProfiles: [],
      supportsMcp: false,
      supportsUsage: false,
      supportsArtifacts: false,
      modalities: ["text"],
      policyEnforceable: false,
    };
    const policy: EffectivePolicy = {
      version: "1",
      approvalMode: "strict",
      workspaceRoots: ["/w"],
      capabilities: [{ id: "shell", decision: "deny" }],
    };
    const r = assertPolicyCompatible(caps, policy);
    expect(r.ok).toBe(false);
  });

  it("assertPolicyCompatible allows gateway-mediated providers", () => {
    const caps: ProviderCapabilities = {
      sessions: "resume",
      toolMediation: "gateway",
      sandboxProfiles: ["workspace"],
      supportsMcp: true,
      supportsUsage: true,
      supportsArtifacts: true,
      modalities: ["text"],
      policyEnforceable: true,
    };
    const policy: EffectivePolicy = {
      version: "1",
      approvalMode: "strict",
      workspaceRoots: ["/w"],
      capabilities: [{ id: "shell", decision: "ask" }],
    };
    expect(assertPolicyCompatible(caps, policy).ok).toBe(true);
  });
});
