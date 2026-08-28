import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeAgentProvider } from "./fake-provider.js";
import { runProviderConformance } from "./conformance.js";
import { ProviderRegistry } from "./registry.js";
import { assertPolicyCompatible } from "./provider.js";
import type { ProviderCapabilities, EffectivePolicy } from "./types.js";
import type { RuntimeEvent } from "./events.js";

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
    const events: RuntimeEvent[] = [];
    await session.runTurn({ goal: "Prepare the launch brief" }, async (event) => {
      events.push(event);
      return "continue";
    });

    expect(events.find((event) => event.type === "permission_request")).toMatchObject({
      path: path.join("/demo/workspace", "grokdesk-demo-report.md"),
      meta: { content: expect.stringContaining("Prepare the launch brief") },
    });
  });

  it("routes 429 / deep-research / image goals without the launch-brief write", async () => {
    const provider = new FakeAgentProvider();
    const mk = async (goal: string) => {
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
      const events: RuntimeEvent[] = [];
      const result = await session.runTurn({ goal }, async (event) => {
        events.push(event);
        return "continue";
      });
      return { events, result };
    };
    const limited = await mk("HTTP 429 capacity overloaded");
    expect(limited.result.status).toBe("failed");
    expect(limited.events.some((e) => e.type === "error")).toBe(true);
    expect(limited.events.some((e) => e.type === "permission_request")).toBe(
      false,
    );
    const research = await mk("/deep-research the market");
    expect(research.events.some((e) => e.type === "workflow_update")).toBe(
      true,
    );
    const imgRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fake-img-"));
    const imgSession = await provider.createSession({
      ref: { providerId: "fake", modelId: "fake-fast" },
      cwd: imgRoot,
      workspaceRoots: [imgRoot],
      policy: {
        version: "1",
        approvalMode: "strict",
        workspaceRoots: [imgRoot],
        capabilities: [{ id: "shell", decision: "ask" }],
      },
    });
    const imgEvents: RuntimeEvent[] = [];
    await imgSession.runTurn({ goal: "/image a red square" }, async (event) => {
      imgEvents.push(event);
      return "continue";
    });
    expect(imgEvents.find((e) => e.type === "artifact")).toMatchObject({
      kind: "media",
    });
    expect(fs.existsSync(path.join(imgRoot, "images", "fake-studio.png"))).toBe(
      true,
    );
    fs.rmSync(imgRoot, { recursive: true, force: true });
  });

  it("fake provider supports interject, compact, and rewind", async () => {
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
    expect(await session.interject?.("aside from the host")).toBe(true);
    expect(await session.interject?.("   ")).toBe(false);
    expect(await session.compact?.()).toBe(true);
    const points = await session.rewindPoints?.();
    expect(points).toEqual([
      expect.objectContaining({ id: "fake-point-1" }),
    ]);
    expect(await session.rewindTo?.(points![0]!.id)).toBe(true);
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
