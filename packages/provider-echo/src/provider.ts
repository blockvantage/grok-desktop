/**
 * Second provider adapter (Phase 5) — capability-honest echo provider.
 *
 * Proves registry neutrality without paid APIs: gateway-mediated tools,
 * policyEnforceable, resume sessions. Distinct from FakeAgentProvider so
 * composition can register grok + echo (+ optional fake) together.
 */
import {
  assertPolicyCompatible,
  type AgentProvider,
  type AgentSession,
  type ModelDescriptor,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderSessionBinding,
  type RuntimeEventSink,
  type SessionInput,
  type TurnInput,
  type TurnResult,
} from "@grokdesk/agent-runtime";

export class EchoAgentProvider implements AgentProvider {
  readonly id = "echo";
  private sessions = new Map<string, EchoAgentSession>();
  private cancelled = new Set<string>();

  async probe(): Promise<ProviderHealth> {
    return {
      ok: true,
      providerId: this.id,
      version: "echo-1.0.0",
      authenticated: true,
      message: "gateway-mediated echo (no network)",
    };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return [
      {
        id: "echo-default",
        displayName: "Echo",
        providerId: this.id,
        modalities: ["text"],
      },
    ];
  }

  async getCapabilities(_modelId: string): Promise<ProviderCapabilities> {
    return {
      sessions: "resume",
      toolMediation: "gateway",
      sandboxProfiles: ["workspace"],
      supportsMcp: false,
      supportsUsage: true,
      supportsArtifacts: true,
      modalities: ["text"],
      policyEnforceable: true,
    };
  }

  async createSession(input: SessionInput): Promise<AgentSession> {
    const caps = await this.getCapabilities(input.ref.modelId);
    const check = assertPolicyCompatible(caps, input.policy);
    if (!check.ok) {
      throw new Error(check.reason);
    }
    const providerSessionId = `echo-sess-${this.sessions.size + 1}`;
    const binding: ProviderSessionBinding = {
      providerId: this.id,
      providerSessionId,
      modelId: input.ref.modelId,
      createdAt: new Date().toISOString(),
    };
    const session = new EchoAgentSession(binding, this.cancelled);
    this.sessions.set(providerSessionId, session);
    return session;
  }

  async resumeSession(binding: ProviderSessionBinding): Promise<AgentSession> {
    const existing = this.sessions.get(binding.providerSessionId);
    if (existing) return existing;
    const session = new EchoAgentSession(binding, this.cancelled);
    this.sessions.set(binding.providerSessionId, session);
    return session;
  }
}

class EchoAgentSession implements AgentSession {
  private turnCount = 0;

  constructor(
    readonly binding: ProviderSessionBinding,
    private cancelled: Set<string>,
  ) {}

  async runTurn(input: TurnInput, sink: RuntimeEventSink): Promise<TurnResult> {
    const key = this.binding.providerSessionId;
    if (this.cancelled.has(key)) {
      return { status: "cancelled", summary: "cancelled before turn" };
    }
    this.turnCount += 1;
    const text = `Echo: ${input.goal}`;
    const signal = await sink({
      type: "message",
      role: "assistant",
      text,
      channel: "text",
    });
    if (signal === "abort" || this.cancelled.has(key)) {
      return { status: "cancelled", summary: "aborted" };
    }
    // Gateway-mediated tool request (host authorizes before effect).
    const toolId = `echo-tool-${this.turnCount}`;
    await sink({
      type: "tool_call",
      id: toolId,
      tool: "write_file",
      path: "/workspace/echo.txt",
    });
    if (this.cancelled.has(key)) {
      return { status: "cancelled", summary: "cancelled mid-tool" };
    }
    await sink({
      type: "tool_result",
      id: toolId,
      ok: true,
      output: "echo stub",
    });
    await sink({
      type: "artifact",
      title: "echo.txt",
      path: "/workspace/echo.txt",
      kind: "file",
    });
    await sink({
      type: "usage",
      usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    });
    await sink({ type: "done", summary: "echo done" });
    return {
      status: "done",
      summary: "echo done",
      providerSessionId: this.binding.providerSessionId,
    };
  }

  async cancel(reason: string): Promise<void> {
    this.cancelled.add(this.binding.providerSessionId);
    void reason;
  }
}
