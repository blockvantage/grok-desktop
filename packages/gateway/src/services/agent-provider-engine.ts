/**
 * Bridge AgentProvider (neutral runtime) → EngineAdapter (legacy TaskRunner).
 *
 * Dual-path product contract (Phase 3/6):
 * - **Default production path:** `createDefaultEngine` / engine-grok headless
 *   (`Gateway.start` when `GROKDESK_PROVIDER_ENGINE` is unset).
 * - **Opt-in bridge:** set `GROKDESK_PROVIDER_ENGINE=1` (optional
 *   `GROKDESK_PROVIDER_ID`, default `grok`) so TaskRunner drives a registered
 *   AgentProvider via this adapter. Tests may inject the adapter directly.
 * - No silent cutover: shipping product must not flip this env by default until
 *   ACP/policy conformance gates pass.
 */
import type {
  AgentProvider,
  AgentSession,
  EffectivePolicy,
  RuntimeEvent,
} from "@grokdesk/agent-runtime";
import { projectAcpProtection } from "@grokdesk/shared";
import type {
  EngineAdapter,
  EngineRunOptions,
  NormalizedEngineEvent,
} from "../engine-types.js";
import { deskPolicyToEffective } from "../provider-composition.js";

export function runtimeEventToNormalized(
  event: RuntimeEvent,
): NormalizedEngineEvent | null {
  switch (event.type) {
    case "message":
      return {
        type: "message",
        role: event.role === "system" ? "assistant" : event.role,
        text: event.text,
        channel: event.channel,
      };
    case "step":
      return { type: "step", title: event.title, status: event.status };
    case "run_progress":
      return { type: "run_progress", message: event.message };
    case "tool_call":
      return {
        type: "tool_request",
        id: event.id,
        tool: mapToolName(event.tool),
        path: event.path,
        command: event.command,
        meta: event.meta,
      };
    case "permission_request":
      return {
        type: "tool_request",
        id: event.id,
        tool: mapToolName(event.tool),
        path: event.path,
        command: event.command,
        meta: { ...(event.meta ?? {}), permissionRequest: true },
      };
    case "tool_result":
      return {
        type: "tool_result",
        id: event.id,
        ok: event.ok,
        output: event.output,
      };
    case "artifact":
      return {
        type: "artifact",
        title: event.title,
        path: event.path,
        kind: event.kind,
      };
    case "done":
      return { type: "done", summary: event.summary };
    case "error":
      return { type: "error", message: event.message };
    case "usage": {
      const u = event.usage ?? {};
      return {
        type: "usage",
        inputTokens: Number(u.inputTokens ?? 0),
        outputTokens: Number(u.outputTokens ?? 0),
        ...((u as { contextWindow?: number }).contextWindow != null
          ? {
              contextWindow: Number(
                (u as { contextWindow?: number }).contextWindow,
              ),
            }
          : {}),
      };
    }
    case "plan":
      return {
        type: "plan_update",
        content: event.content,
        status: event.status,
      };
    case "citations":
      return {
        type: "citations",
        items: event.items,
      };
    default:
      return null;
  }
}

function mapToolName(
  tool: string,
): Extract<NormalizedEngineEvent, { type: "tool_request" }>["tool"] {
  const t = tool.toLowerCase();
  // Media tools before write/edit heuristics (image_edit would match "edit").
  if (
    t === "image_gen" ||
    t === "image_edit" ||
    t === "image_to_video" ||
    t === "reference_to_video" ||
    t.includes("imagine")
  )
    return "media";
  if (t === "read_file" || t.includes("read")) return "read_file";
  if (t === "write_file" || t.includes("write") || t.includes("edit"))
    return "write_file";
  if (t === "delete_file" || t.includes("delete")) return "delete_file";
  if (t === "shell" || t.includes("bash") || t.includes("exec")) return "shell";
  if (t === "network" || t.includes("http") || t.includes("fetch"))
    return "network";
  if (t.startsWith("browser_")) {
    const known = [
      "browser_open",
      "browser_click",
      "browser_type",
      "browser_scroll",
      "browser_screenshot",
      "browser_read",
    ] as const;
    if ((known as readonly string[]).includes(t)) {
      return t as (typeof known)[number];
    }
  }
  return "other";
}

export interface AgentProviderEngineOptions {
  provider: AgentProvider;
  /** When true (default), derive executesOwnTools from provider capabilities. */
  resolveExecutesOwnTools?: boolean;
  /** Override executesOwnTools (tests). */
  executesOwnTools?: boolean;
  /** Headless engine used per-task when provider session creation fails. */
  fallbackEngine?: EngineAdapter;
  /**
   * T1/T3: CLI probe `supportsSandbox` from createLiveAcpTransportFactory.
   * Fail closed when undefined/false — never invent sandbox from static caps.
   * Must match the probe used to build ACP spawn argv.
   */
  supportsSandbox?: boolean;
}

/**
 * EngineAdapter that drives AgentProvider.createSession + runTurn.
 */
const MAX_AGENT_SESSIONS = 64;

export class AgentProviderEngine implements EngineAdapter {
  private sessions = new Map<string, AgentSession>();
  private fellBack = new Set<string>();
  private providerCircuit: { openedAt: number; reason: string } | null = null;
  private executesOwnToolsFlag: boolean;
  private capsResolved = false;

  constructor(private opts: AgentProviderEngineOptions) {
    this.executesOwnToolsFlag = opts.executesOwnTools ?? true;
  }

  get executesOwnTools(): boolean {
    if (this.providerCircuit && this.opts.fallbackEngine) {
      return this.opts.fallbackEngine.executesOwnTools;
    }
    return this.executesOwnToolsFlag;
  }

  private cacheSession(taskId: string, session: AgentSession): void {
    if (!this.sessions.has(taskId)) {
      while (this.sessions.size >= MAX_AGENT_SESSIONS) {
        const oldest = this.sessions.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.sessions.delete(oldest);
        this.fellBack.delete(oldest);
      }
    } else {
      this.sessions.delete(taskId);
    }
    this.sessions.set(taskId, session);
  }

  private async ensureCaps(modelId: string): Promise<void> {
    if (this.capsResolved && this.opts.executesOwnTools !== undefined) return;
    if (this.opts.resolveExecutesOwnTools === false) return;
    if (this.opts.executesOwnTools !== undefined) {
      this.capsResolved = true;
      return;
    }
    const caps = await this.opts.provider.getCapabilities(modelId);
    // Gateway-mediated or permission-rpc ⇒ runner may execute tools; uncontrolled ⇒ provider owns tools.
    this.executesOwnToolsFlag =
      caps.toolMediation === "uncontrolled" || !caps.policyEnforceable;
    this.capsResolved = true;
  }

  async run(options: EngineRunOptions): Promise<void> {
    const { task, systemPreamble, onEvent } = options;

    if (
      (this.fellBack.has(task.id) || this.providerCircuit) &&
      this.opts.fallbackEngine
    ) {
      this.fellBack.add(task.id);
      return this.opts.fallbackEngine.run(options);
    }

    await this.ensureCaps(task.model);

    const policy: EffectivePolicy = deskPolicyToEffective(task.policySnapshot);
    const cwd =
      task.policySnapshot.workspaceRoots[0] ?? process.cwd();

    const sessionInput = {
      ref: {
        providerId: this.opts.provider.id,
        modelId: task.model,
      },
      cwd,
      workspaceRoots: task.policySnapshot.workspaceRoots,
      policy,
      systemPreamble,
      inheritUserConfig: options.isolateGrokHome === false,
      planFirst: options.planFirst === true || task.planFirst === true,
    };

    let session = this.sessions.get(task.id);
    if (!session && options.priorProviderSessionId) {
      try {
        const resume = this.opts.provider.resumeSession.bind(
          this.opts.provider,
        ) as (
          binding: {
            providerId: string;
            providerSessionId: string;
            modelId: string;
            createdAt: string;
          },
          input?: typeof sessionInput,
        ) => Promise<AgentSession>;
        session = await resume(
          {
            providerId: this.opts.provider.id,
            providerSessionId: options.priorProviderSessionId,
            modelId: task.model,
            createdAt: new Date().toISOString(),
          },
          sessionInput,
        );
        this.cacheSession(task.id, session);
      } catch {
        session = undefined; // fall through to fresh create
      }
    }
    if (!session) {
      try {
        session = await this.opts.provider.createSession(sessionInput);
        this.cacheSession(task.id, session);
      } catch (e) {
        if (this.opts.fallbackEngine) {
          this.providerCircuit = {
            openedAt: Date.now(),
            reason: e instanceof Error ? e.message : String(e),
          };
          this.fellBack.add(task.id);
          await onEvent({
            type: "run_progress",
            message: `ACP unavailable (${e instanceof Error ? e.message : String(e)}) — falling back to headless engine for this task.`,
          });
          return this.opts.fallbackEngine.run(options);
        }
        throw e;
      }
    }

    // T3: protection from the **same** probe flag as ACP spawn (fail closed).
    // Never use static GROK_ACP_TARGET_CAPABILITIES.sandboxProfiles — those
    // advertise intent, not live CLI probe support.
    const supportsSandbox = this.opts.supportsSandbox === true;
    const deskPolicy = {
      approvalMode: task.policySnapshot.approvalMode,
      workspaceRoots: task.policySnapshot.workspaceRoots,
      allowShell: task.policySnapshot.allowShell,
      allowNetworkTools: task.policySnapshot.allowNetworkTools,
    };
    const protection = projectAcpProtection({
      cwd,
      policy: deskPolicy,
      supportsSandbox,
      isolateGrokHome: options.isolateGrokHome !== false,
      executesOwnTools: this.executesOwnToolsFlag !== false,
    });
    await onEvent({
      type: "session_meta",
      protection: {
        spawnArgs: protection.spawnArgs,
        supportsSandbox,
        isolateGrokHome: options.isolateGrokHome !== false,
        executesOwnTools: this.executesOwnToolsFlag !== false,
      },
    });

    let sawDone = false;
    const result = await session.runTurn(
      { goal: task.goal },
      async (ev) => {
        if (ev.type === "done") sawDone = true;
        const norm = runtimeEventToNormalized(ev);
        if (!norm) return "continue";
        return onEvent(norm);
      },
    );

    if (result.status === "cancelled") {
      if (!sawDone) {
        await onEvent({
          type: "error",
          message: result.summary ?? "cancelled",
        });
      }
      return;
    }
    if (result.status === "failed") {
      await onEvent({
        type: "error",
        message: result.summary ?? "provider turn failed",
      });
      return;
    }
    // Only synthesize done if the provider returned success without a done event.
    if (result.status === "done" && !sawDone) {
      await onEvent({
        type: "done",
        summary: result.summary ?? "done",
      });
    }
  }

  async cancel(taskId: string): Promise<void> {
    if (this.fellBack.has(taskId)) {
      this.fellBack.delete(taskId);
      await this.opts.fallbackEngine?.cancel(taskId);
      return;
    }
    const session = this.sessions.get(taskId);
    if (session) {
      await session.cancel("gateway_cancel");
      this.sessions.delete(taskId);
    }
  }

  async interject(
    taskId: string,
    text: string,
    clientMutationId?: string,
  ): Promise<boolean> {
    if (this.fellBack.has(taskId)) return false;
    const session = this.sessions.get(taskId);
    if (!session?.interject) return false;
    return session.interject(
      text,
      clientMutationId ? { clientMutationId } : undefined,
    );
  }

  async compact(taskId: string): Promise<boolean> {
    if (this.fellBack.has(taskId)) return false;
    const session = this.sessions.get(taskId);
    if (!session?.compact) return false;
    return session.compact();
  }

  async rewindPoints(
    taskId: string,
  ): Promise<Array<{
    id: string;
    label?: string;
    files?: string[];
    hasFileChanges?: boolean;
  }> | null> {
    if (this.fellBack.has(taskId)) return null;
    const session = this.sessions.get(taskId);
    if (!session?.rewindPoints) return null;
    return session.rewindPoints();
  }

  async rewindTo(taskId: string, pointId: string): Promise<boolean> {
    if (this.fellBack.has(taskId)) return false;
    const session = this.sessions.get(taskId);
    if (!session?.rewindTo) return false;
    return session.rewindTo(pointId);
  }
}

/** Factory for composition root. */
export function createAgentProviderEngine(
  provider: AgentProvider,
  opts?: Omit<AgentProviderEngineOptions, "provider">,
): AgentProviderEngine {
  return new AgentProviderEngine({ provider, ...opts });
}
