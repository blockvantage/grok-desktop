/**
 * Phase 5: composition root registers multiple adapters; both pass conformance.
 */
import { describe, it, expect } from "vitest";
import { runProviderConformance } from "@grokdesk/agent-runtime";
import { createDefaultProviderRegistry } from "../provider-composition.js";
import {
  canClaimProductDefaultAgentProvider,
  evaluateDefaultCutoverReadiness,
  resolveEngineSelection,
} from "../services/engine-selection.js";

describe("multi-provider composition (Phase 5)", () => {
  it("registers grok + echo and both pass core conformance", async () => {
    const reg = createDefaultProviderRegistry({ includeFake: true });
    const ids = reg.list().map((p) => p.id).sort();
    expect(ids).toEqual(expect.arrayContaining(["echo", "fake", "grok"]));

    for (const id of ["echo", "fake"] as const) {
      const result = await runProviderConformance(reg.require(id));
      expect(result.failed, `${id} conformance`).toEqual([]);
    }
  });

  it("echo caps are cutover-ready while product default stays engine-grok", async () => {
    const reg = createDefaultProviderRegistry();
    const caps = await reg.require("echo").getCapabilities("echo-default");
    expect(evaluateDefaultCutoverReadiness(caps).ready).toBe(true);

    // Product default must not silently flip — opt-in still required.
    const selection = resolveEngineSelection({ env: {} });
    expect(selection.mode).toBe("engine-grok");
    expect(
      canClaimProductDefaultAgentProvider(selection, caps).claimable,
    ).toBe(false);

    // Opt-in path with echo is claimable for product default.
    const optIn = resolveEngineSelection({
      env: {
        GROKDESK_PROVIDER_ENGINE: "1",
        GROKDESK_PROVIDER_ID: "echo",
      },
    });
    expect(optIn.mode).toBe("agent-provider");
    expect(optIn.providerId).toBe("echo");
    expect(canClaimProductDefaultAgentProvider(optIn, caps).claimable).toBe(
      true,
    );
  });

  it("headless grok is not cutover-ready", async () => {
    const reg = createDefaultProviderRegistry();
    const caps = await reg.require("grok").getCapabilities("grok-4.5");
    // Headless-degraded remains uncontrolled / not policyEnforceable.
    expect(evaluateDefaultCutoverReadiness(caps).ready).toBe(false);
  });
});
