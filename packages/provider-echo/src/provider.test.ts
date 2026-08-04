import { describe, it, expect } from "vitest";
import { runProviderConformance } from "@grokdesk/agent-runtime";
import { EchoAgentProvider } from "./provider.js";

describe("EchoAgentProvider (Phase 5 second provider)", () => {
  it("passes agent-runtime conformance kit", async () => {
    const provider = new EchoAgentProvider();
    const result = await runProviderConformance(provider);
    expect(result.failed).toEqual([]);
    expect(result.passed.length).toBeGreaterThan(0);
    expect(result.providerId).toBe("echo");
  });

  it("advertises gateway mediation and policyEnforceable", async () => {
    const provider = new EchoAgentProvider();
    const caps = await provider.getCapabilities("echo-default");
    expect(caps.toolMediation).toBe("gateway");
    expect(caps.policyEnforceable).toBe(true);
    expect(caps.sessions).toBe("resume");
  });

  it("echoes goal through a session turn", async () => {
    const provider = new EchoAgentProvider();
    const session = await provider.createSession({
      ref: { providerId: "echo", modelId: "echo-default" },
      cwd: "/workspace",
      workspaceRoots: ["/workspace"],
      policy: {
        version: "1",
        approvalMode: "balanced",
        workspaceRoots: ["/workspace"],
        capabilities: [
          { id: "shell", decision: "ask" },
          { id: "network", decision: "allow" },
        ],
      },
    });
    const texts: string[] = [];
    const result = await session.runTurn({ goal: "hello desk" }, async (ev) => {
      if (ev.type === "message") texts.push(ev.text);
      return "continue";
    });
    expect(result.status).toBe("done");
    expect(texts.some((t) => t.includes("hello desk"))).toBe(true);
  });
});
