import { describe, it, expect } from "vitest";
import { createDefaultProviderRegistry } from "../provider-composition.js";
import { createProviderPreflight } from "./provider-preflight.js";
import type { Task } from "@grokdesk/shared";
import {
  MemoryLineDuplex,
  attachFakeAcpAgent,
} from "@grokdesk/provider-grok";

function fakeTask(
  policy: Partial<Task["policySnapshot"]> & {
    approvalMode?: Task["policySnapshot"]["approvalMode"];
  },
): Task {
  return {
    id: "t1",
    goal: "g",
    title: null,
    mode: "agent",
    status: "queued",
    model: "grok-4.5",
    effort: "low",
    policySnapshot: {
      approvalMode: policy.approvalMode ?? "balanced",
      workspaceRoots: ["/w"],
      allowShell: policy.allowShell ?? true,
      allowNetworkTools: policy.allowNetworkTools ?? true,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
}

describe("createProviderPreflight (registry-backed)", () => {
  it("rejects headless when shell is denied (fail closed)", async () => {
    const reg = createDefaultProviderRegistry();
    const preflight = createProviderPreflight(reg);
    const r = await preflight(
      fakeTask({ allowShell: false, allowNetworkTools: true }),
    );
    expect(r.action).toBe("reject");
    if (r.action === "reject") {
      expect(r.reason).toMatch(/fail-closed|cannot guarantee/i);
    }
  });

  it("degrades headless under strict when shell/network still allowed", async () => {
    const reg = createDefaultProviderRegistry();
    const preflight = createProviderPreflight(reg);
    const r = await preflight(
      fakeTask({
        approvalMode: "strict",
        allowShell: true,
        allowNetworkTools: true,
      }),
    );
    expect(r.action).toBe("degraded");
  });

  it("proceeds headless on balanced when shell/network allowed", async () => {
    const reg = createDefaultProviderRegistry();
    const preflight = createProviderPreflight(reg);
    const r = await preflight(
      fakeTask({
        approvalMode: "balanced",
        allowShell: true,
        allowNetworkTools: true,
      }),
    );
    expect(r.action).toBe("proceed");
  });

  it("ACP registry proceeds under deny shell (enforcement deferred to permission RPC)", async () => {
    const reg = createDefaultProviderRegistry({
      preferAcp: true,
      acpTransportFactory: () => {
        const d = new MemoryLineDuplex();
        attachFakeAcpAgent(d.b, { requirePermission: false });
        return d.a;
      },
    });
    const preflight = createProviderPreflight(reg);
    const r = await preflight(
      fakeTask({
        approvalMode: "strict",
        allowShell: false,
        allowNetworkTools: false,
      }),
    );
    expect(r.action).toBe("proceed");
  });

  it("rejects when provider id missing from registry", async () => {
    const reg = createDefaultProviderRegistry();
    const preflight = createProviderPreflight(reg, {
      defaultProviderId: "missing-provider",
    });
    const r = await preflight(fakeTask({}));
    expect(r.action).toBe("reject");
  });
});
