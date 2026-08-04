import { describe, it, expect } from "vitest";
import {
  resolveEngineSelection,
  evaluateDefaultCutoverReadiness,
  canClaimProductDefaultAgentProvider,
} from "./engine-selection.js";

describe("resolveEngineSelection", () => {
  it("defaults to engine-grok without opt-in when ACP unavailable", () => {
    const s = resolveEngineSelection({ env: {}, acpAvailable: false });
    expect(s.mode).toBe("engine-grok");
    expect(s.reasons).toContain("default:engine-grok");
  });

  it("defaults to agent-provider + ACP when probe reports agent stdio", () => {
    const sel = resolveEngineSelection({ env: {}, acpAvailable: true });
    expect(sel.mode).toBe("agent-provider");
    expect(sel.preferAcp).toBe(true);
    expect(sel.reasons).toContain("default:agent-provider(acp-available)");
  });

  it("GROKDESK_FORCE_HEADLESS=1 wins over everything", () => {
    const sel = resolveEngineSelection({
      env: { GROKDESK_FORCE_HEADLESS: "1", GROKDESK_PROVIDER_ENGINE: "1" },
      acpAvailable: true,
    });
    expect(sel.mode).toBe("engine-grok");
    expect(sel.reasons).toContain("GROKDESK_FORCE_HEADLESS=1");
  });

  it("stays headless-default when ACP is unavailable and nothing opted in", () => {
    const sel = resolveEngineSelection({ env: {}, acpAvailable: false });
    expect(sel.mode).toBe("engine-grok");
  });

  it("selects agent-provider when GROKDESK_PROVIDER_ENGINE=1", () => {
    const s = resolveEngineSelection({
      env: {
        GROKDESK_PROVIDER_ENGINE: "1",
        GROKDESK_PROVIDER_ID: "fake",
        GROKDESK_ACP: "1",
      },
    });
    expect(s.mode).toBe("agent-provider");
    expect(s.providerId).toBe("fake");
    expect(s.preferAcp).toBe(true);
  });

  it("selects agent-provider from settings flag alone", () => {
    const s = resolveEngineSelection({
      env: {},
      preferProviderEngine: true,
    });
    expect(s.mode).toBe("agent-provider");
    expect(s.providerId).toBe("grok");
    expect(s.reasons).toContain("settings.preferProviderEngine");
  });

  it("settings false does not override missing env when ACP unavailable", () => {
    const s = resolveEngineSelection({
      env: {},
      preferProviderEngine: false,
      acpAvailable: false,
    });
    expect(s.mode).toBe("engine-grok");
  });
});

describe("cutover readiness", () => {
  it("rejects uncontrolled headless caps for product default", () => {
    const r = evaluateDefaultCutoverReadiness({
      policyEnforceable: false,
      toolMediation: "uncontrolled",
    });
    expect(r.ready).toBe(false);
    expect(r.blockers.length).toBeGreaterThan(0);
  });

  it("accepts ACP permission-rpc caps", () => {
    const r = evaluateDefaultCutoverReadiness({
      policyEnforceable: true,
      toolMediation: "provider-permission-rpc",
    });
    expect(r.ready).toBe(true);
  });

  it("accepts gateway-mediated caps (runtime ToolMediation=gateway)", () => {
    const r = evaluateDefaultCutoverReadiness({
      policyEnforceable: true,
      toolMediation: "gateway",
    });
    expect(r.ready).toBe(true);
  });

  it("canClaimProductDefault requires agent-provider + ready + preferAcp or gateway", () => {
    const selection = resolveEngineSelection({
      env: { GROKDESK_PROVIDER_ENGINE: "1", GROKDESK_ACP: "1" },
    });
    const claim = canClaimProductDefaultAgentProvider(selection, {
      policyEnforceable: true,
      toolMediation: "provider-permission-rpc",
    });
    expect(claim.claimable).toBe(true);

    // Gateway-mediated provider can claim default without ACP flag.
    const gatewaySelection = resolveEngineSelection({
      env: { GROKDESK_PROVIDER_ENGINE: "1", GROKDESK_PROVIDER_ID: "echo" },
    });
    const claimGateway = canClaimProductDefaultAgentProvider(gatewaySelection, {
      policyEnforceable: true,
      toolMediation: "gateway",
    });
    expect(claimGateway.claimable).toBe(true);

    const headless = resolveEngineSelection({
      env: { GROKDESK_PROVIDER_ENGINE: "1" },
    });
    const claimHeadless = canClaimProductDefaultAgentProvider(headless, {
      policyEnforceable: true,
      toolMediation: "provider-permission-rpc",
    });
    expect(claimHeadless.claimable).toBe(false);
  });

  it("product default without ACP remains engine-grok (no silent cutover)", () => {
    const s = resolveEngineSelection({
      env: {},
      preferProviderEngine: false,
      acpAvailable: false,
    });
    expect(s.mode).toBe("engine-grok");
    const claim = canClaimProductDefaultAgentProvider(s, {
      policyEnforceable: true,
      toolMediation: "gateway",
    });
    expect(claim.claimable).toBe(false);
  });

  it("product default with ACP available is claimable when caps pass", () => {
    const s = resolveEngineSelection({ env: {}, acpAvailable: true });
    expect(s.mode).toBe("agent-provider");
    expect(s.preferAcp).toBe(true);
    const claim = canClaimProductDefaultAgentProvider(s, {
      policyEnforceable: true,
      toolMediation: "provider-permission-rpc",
    });
    expect(claim.claimable).toBe(true);
  });
});
