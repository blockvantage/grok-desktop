/**
 * Grok provider adapter (provider one).
 *
 * - headless-degraded: streaming path; uncontrolled tool mediation; fail-closed
 *   when policy requires enforcement.
 * - acp: policy-mediated via session/request_permission (fake or real transport).
 *   Real CLI spawn is gated by GROKDESK_ACP=1; tests inject MemoryLineDuplex.
 */
import {
  assertPolicyCompatible,
  type AgentProvider,
  type AgentSession,
  type SessionInput,
  type TurnInput,
  type TurnResult,
  type RuntimeEventSink,
  type ModelDescriptor,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderSessionBinding,
} from "@grokdesk/agent-runtime";
import {
  GROK_ACP_TARGET_CAPABILITIES,
  GROK_HEADLESS_CAPABILITIES,
} from "./capabilities.js";
import type { AcpLineTransport } from "./acp-jsonrpc.js";
import {
  AcpMediatedSession,
  createAcpBinding,
} from "./acp-session.js";

export type GrokProviderMode = "headless-degraded" | "acp";

export interface GrokAgentProviderOptions {
  mode?: GrokProviderMode;
  /** When true, refuse unenforceable policies instead of silent degrade. */
  failClosedOnUnenforceablePolicy?: boolean;
  /**
   * Inject ACP line transport (tests / fake peer). Required for mode=acp
   * unless a factory is used.
   */
  acpTransportFactory?: (input: SessionInput) => AcpLineTransport | Promise<AcpLineTransport>;
  /**
   * Optional live model catalog (e.g. auth-session list from gateway).
   * Falls back to the built-in pair when missing or when the source throws.
   */
  models?: () => Promise<ModelDescriptor[]>;
  onAuthorizationReceipt?: (receipt: {
    action: string;
    decision: "allow" | "deny" | "ask";
    capabilityId: string;
    kind?: string;
    title?: string;
    reason: string;
  }) => void;
}

const FALLBACK_MODELS: ModelDescriptor[] = [
  {
    id: "grok-4.5",
    displayName: "Grok 4.5",
    providerId: "grok",
    modalities: ["text", "image", "video"],
  },
  {
    id: "grok-composer-2.5-fast",
    displayName: "Grok Composer 2.5 Fast",
    providerId: "grok",
    modalities: ["text"],
  },
];

export class GrokAgentProvider implements AgentProvider {
  readonly id = "grok";

  constructor(private opts?: GrokAgentProviderOptions) {}

  get mode(): GrokProviderMode {
    return this.opts?.mode ?? "headless-degraded";
  }

  async probe(): Promise<ProviderHealth> {
    const available =
      this.mode === "acp" &&
      typeof this.opts?.acpTransportFactory === "function";
    return {
      ok: available,
      providerId: this.id,
      version: this.mode === "acp" ? "acp-mediated" : "headless-degraded",
      authenticated: false,
      message: available
        ? "ACP mode: tool permissions authorized by Desk policy broker"
        : "Provider unavailable: a verified ACP transport is required",
    };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    if (!(await this.probe()).ok) return [];
    if (this.opts?.models) {
      try {
        const live = await this.opts.models();
        if (live.length) return live;
      } catch {
        /* fall through to offline catalog */
      }
    }
    return FALLBACK_MODELS.map((m) => ({ ...m, providerId: this.id }));
  }

  async getCapabilities(_modelId: string): Promise<ProviderCapabilities> {
    if (this.mode === "acp") {
      return { ...GROK_ACP_TARGET_CAPABILITIES };
    }
    return { ...GROK_HEADLESS_CAPABILITIES };
  }

  async createSession(input: SessionInput): Promise<AgentSession> {
    const caps = await this.getCapabilities(input.ref.modelId);
    const check = assertPolicyCompatible(caps, input.policy);
    if (!check.ok) {
      if (this.opts?.failClosedOnUnenforceablePolicy !== false) {
        throw new Error(
          `${check.reason} (provider=grok mode=${this.mode})`,
        );
      }
    }

    if (this.mode === "acp") {
      const factory = this.opts?.acpTransportFactory;
      if (!factory) {
        throw new Error(
          "ACP mode requires acpTransportFactory (or GROKDESK_ACP stdio factory). " +
            "Do not claim live CLI mediation without a transport.",
        );
      }
      const transport = await factory(input);
      const binding = createAcpBinding(input.ref.modelId);
      const session = new AcpMediatedSession({
        transport,
        policy: input.policy,
        binding,
        onReceipt: this.opts?.onAuthorizationReceipt,
        planFirst: input.planFirst === true,
      });
      await session.start(input.cwd, { planFirst: input.planFirst === true });
      return session;
    }

    const binding: ProviderSessionBinding = {
      providerId: this.id,
      providerSessionId: `grok-headless-${Date.now()}`,
      modelId: input.ref.modelId,
      createdAt: new Date().toISOString(),
    };
    return new GrokHeadlessSession(binding, input, !check.ok);
  }

  async resumeSession(
    binding: ProviderSessionBinding,
    input?: SessionInput,
  ): Promise<AgentSession> {
    if (this.mode === "acp") {
      const factory = this.opts?.acpTransportFactory;
      if (!factory) {
        throw new Error(
          "ACP resume requires an active transport; use transcript_fallback or re-create session",
        );
      }
      // Soft resume: re-open transport and re-bind session id. Real CLI loadSession
      // is negotiated when available; fake peer always creates a fresh session id
      // but we preserve the binding for gateway transcript correlation.
      const sessionInput: SessionInput = input ?? {
        ref: { providerId: binding.providerId, modelId: binding.modelId },
        cwd: process.cwd(),
        workspaceRoots: [],
        policy: {
          version: "1",
          approvalMode: "balanced",
          workspaceRoots: [],
          capabilities: [],
        },
      };
      const transport = await factory(sessionInput);
      const session = new AcpMediatedSession({
        transport,
        policy: sessionInput.policy,
        binding: { ...binding },
        onReceipt: this.opts?.onAuthorizationReceipt,
      });
      await session.start(sessionInput.cwd);
      // Restore original provider session id for correlation (conformance + TASK-02).
      (session.binding as { providerSessionId: string }).providerSessionId =
        binding.providerSessionId;
      return session;
    }
    return new GrokHeadlessSession(
      binding,
      input ?? {
        ref: { providerId: binding.providerId, modelId: binding.modelId },
        cwd: process.cwd(),
        workspaceRoots: [],
        policy: {
          version: "1",
          approvalMode: "balanced",
          workspaceRoots: [],
          capabilities: [],
        },
      },
      true,
    );
  }
}

class GrokHeadlessSession implements AgentSession {
  private cancelled = false;

  constructor(
    readonly binding: ProviderSessionBinding,
    input: SessionInput,
    degraded: boolean,
  ) {
    void input;
    void degraded;
  }

  async runTurn(turn: TurnInput, sink: RuntimeEventSink): Promise<TurnResult> {
    void turn;
    void sink;
    if (this.cancelled) {
      return { status: "cancelled", summary: "cancelled" };
    }
    throw new Error(
      "provider_unavailable: Grok AgentProvider requires a verified ACP transport; use the managed engine runtime",
    );
  }

  async cancel(_reason: string): Promise<void> {
    this.cancelled = true;
  }
}
