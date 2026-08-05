import path from "node:path";
import type { RuntimeEventSink } from "./events.js";
import type {
  AgentProvider,
  AgentSession,
  SessionInput,
  TurnInput,
  TurnResult,
} from "./provider.js";
import { assertPolicyCompatible } from "./provider.js";
import type {
  ModelDescriptor,
  ProviderCapabilities,
  ProviderHealth,
  ProviderSessionBinding,
} from "./types.js";

/**
 * Conformance-kit fake provider: gateway-mediated tools, resumable sessions.
 */
export class FakeAgentProvider implements AgentProvider {
  readonly id = "fake";
  private sessions = new Map<string, FakeAgentSession>();
  private cancelled = new Set<string>();

  async probe(): Promise<ProviderHealth> {
    return {
      ok: true,
      providerId: this.id,
      version: "fake-1.0.0",
      authenticated: true,
    };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return [
      {
        id: "fake-fast",
        displayName: "Fake Fast",
        providerId: this.id,
        modalities: ["text"],
      },
      {
        id: "fake-heavy",
        displayName: "Fake Heavy",
        providerId: this.id,
        modalities: ["text", "image"],
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
      modalities: ["text", "image"],
      policyEnforceable: true,
    };
  }

  async createSession(input: SessionInput): Promise<AgentSession> {
    const caps = await this.getCapabilities(input.ref.modelId);
    const check = assertPolicyCompatible(caps, input.policy);
    if (!check.ok) {
      throw new Error(check.reason);
    }
    const providerSessionId = `fake-sess-${this.sessions.size + 1}`;
    const binding: ProviderSessionBinding = {
      providerId: this.id,
      providerSessionId,
      modelId: input.ref.modelId,
      createdAt: new Date().toISOString(),
    };
    const session = new FakeAgentSession(binding, this.cancelled, input.cwd);
    this.sessions.set(providerSessionId, session);
    return session;
  }

  async resumeSession(binding: ProviderSessionBinding): Promise<AgentSession> {
    const existing = this.sessions.get(binding.providerSessionId);
    if (existing) return existing;
    // Deterministic transcript fallback: re-create empty session with same id.
    const session = new FakeAgentSession(binding, this.cancelled, process.cwd());
    this.sessions.set(binding.providerSessionId, session);
    return session;
  }
}

class FakeAgentSession implements AgentSession {
  private turnCount = 0;

  constructor(
    readonly binding: ProviderSessionBinding,
    private cancelled: Set<string>,
    private cwd: string,
  ) {}

  async runTurn(input: TurnInput, sink: RuntimeEventSink): Promise<TurnResult> {
    const key = this.binding.providerSessionId;
    if (this.cancelled.has(key)) {
      return { status: "cancelled", summary: "cancelled before turn" };
    }
    this.turnCount += 1;
    const signal = await sink({
      type: "message",
      role: "assistant",
      text: `I’m drafting a focused brief for “${input.goal}”.`,
      channel: "text",
    });
    if (signal === "abort" || this.cancelled.has(key)) {
      return { status: "cancelled", summary: "aborted" };
    }
    // Emit a mediated tool call inside the session workspace so the gateway
    // can exercise its real policy, approval, write, and artifact paths.
    const outputPath = path.join(this.cwd, "grokdesk-demo-report.md");
    const content = [
      "# Launch brief",
      "",
      `Goal: ${input.goal}`,
      "",
      "## Executive summary",
      "",
      "A focused launch plan with clear ownership, review points, and a practical path to delivery.",
      "",
      "## Implementation checklist",
      "",
      "- Confirm the audience and success criteria",
      "- Align messaging and launch channels",
      "- Assign owners and target dates",
      "- Review results and capture follow-ups",
      "",
    ].join("\n");
    const perm = await sink({
      type: "permission_request",
      id: `perm-${this.turnCount}`,
      tool: "write_file",
      path: outputPath,
      meta: { content },
    });
    if (perm === "abort") {
      return { status: "cancelled", summary: "permission aborted" };
    }
    await sink({
      type: "tool_result",
      id: `perm-${this.turnCount}`,
      ok: true,
      output: "Saved grokdesk-demo-report.md",
    });
    await sink({
      type: "artifact",
      title: "Launch brief",
      path: outputPath,
      kind: "report",
    });
    const sourceUrl =
      "https://www.electronjs.org/docs/latest/tutorial/security";
    await sink({
      type: "citations",
      items: [
        {
          url: sourceUrl,
          title: "Electron security guide",
          source: "web",
        },
      ],
    });
    await sink({
      type: "message",
      role: "assistant",
      text: `Your launch brief is ready. Review the [Electron security guide](${sourceUrl}) for the linked source.`,
      channel: "text",
    });
    await sink({
      type: "usage",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    });
    const summary = "Launch brief ready — saved to your workspace.";
    await sink({ type: "done", summary });
    return {
      status: "done",
      summary,
      providerSessionId: this.binding.providerSessionId,
    };
  }

  async cancel(reason: string): Promise<void> {
    this.cancelled.add(this.binding.providerSessionId);
    void reason;
  }
}
