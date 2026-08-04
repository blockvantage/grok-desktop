/**
 * Provider conformance kit — same suite for fake and real adapters.
 */
import type { AgentProvider } from "./provider.js";
import type { EffectivePolicy } from "./types.js";
import type { RuntimeEvent } from "./events.js";

export interface ConformanceResult {
  providerId: string;
  passed: string[];
  failed: Array<{ name: string; error: string }>;
}

const basePolicy = (): EffectivePolicy => ({
  version: "1",
  approvalMode: "balanced",
  workspaceRoots: ["/workspace"],
  capabilities: [
    { id: "shell", decision: "ask" },
    { id: "network", decision: "allow" },
  ],
});

/**
 * Run the core conformance suite against a provider.
 * Throws nothing — returns pass/fail list for CI reporting.
 */
export async function runProviderConformance(
  provider: AgentProvider,
): Promise<ConformanceResult> {
  const passed: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      passed.push(name);
    } catch (e) {
      failed.push({
        name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  await check("probe", async () => {
    const h = await provider.probe();
    if (!h.ok) throw new Error(`probe not ok: ${h.message}`);
    if (h.providerId !== provider.id) {
      throw new Error("probe providerId mismatch");
    }
  });

  await check("listModels", async () => {
    const models = await provider.listModels();
    if (!models.length) throw new Error("no models");
    for (const m of models) {
      if (m.providerId !== provider.id) {
        throw new Error(`model ${m.id} wrong providerId`);
      }
    }
  });

  await check("capabilities", async () => {
    const models = await provider.listModels();
    const caps = await provider.getCapabilities(models[0]!.id);
    if (!caps.toolMediation) throw new Error("missing toolMediation");
    if (!Array.isArray(caps.modalities)) throw new Error("missing modalities");
  });

  await check("createSession_and_turn", async () => {
    const models = await provider.listModels();
    const session = await provider.createSession({
      ref: { providerId: provider.id, modelId: models[0]!.id },
      cwd: "/workspace",
      workspaceRoots: ["/workspace"],
      policy: basePolicy(),
      systemPreamble: "conformance",
    });
    const events: RuntimeEvent[] = [];
    const result = await session.runTurn(
      { goal: "conformance goal" },
      async (ev) => {
        events.push(ev);
        return "continue";
      },
    );
    if (result.status !== "done") {
      throw new Error(`expected done, got ${result.status}`);
    }
    if (!events.some((e) => e.type === "done")) {
      throw new Error("missing done event");
    }
  });

  await check("cancel", async () => {
    const models = await provider.listModels();
    const session = await provider.createSession({
      ref: { providerId: provider.id, modelId: models[0]!.id },
      cwd: "/workspace",
      workspaceRoots: ["/workspace"],
      policy: basePolicy(),
    });
    await session.cancel("conformance");
    const result = await session.runTurn(
      { goal: "after cancel" },
      async () => "continue",
    );
    if (result.status !== "cancelled") {
      throw new Error(`expected cancelled, got ${result.status}`);
    }
  });

  await check("resumeSession", async () => {
    const models = await provider.listModels();
    const session = await provider.createSession({
      ref: { providerId: provider.id, modelId: models[0]!.id },
      cwd: "/workspace",
      workspaceRoots: ["/workspace"],
      policy: basePolicy(),
    });
    const resumed = await provider.resumeSession(session.binding);
    if (resumed.binding.providerSessionId !== session.binding.providerSessionId) {
      throw new Error("resume lost session id");
    }
  });

  return { providerId: provider.id, passed, failed };
}
