/**
 * ACP-mediated AgentSession: policy authorizes every tool permission RPC.
 * Works over any AcpLineTransport (fake duplex or real stdio).
 *
 * Extensions (x.ai/*) degrade on -32601 method-not-found.
 */
import {
  waitHumanPermission,
  resolveHumanPermission,
  type AgentSession,
  type EffectivePolicy,
  type ProviderSessionBinding,
  type SessionInput,
  type TurnInput,
  type TurnResult,
  type RuntimeEventSink,
} from "@grokdesk/agent-runtime";
import {
  AcpJsonRpcClient,
  type AcpLineTransport,
  type AcpPermissionDecision,
} from "./acp-jsonrpc.js";
import {
  applyApproverOverride,
  resolveAcpPermission,
  type PermissionBrokerResult,
} from "./acp-policy-broker.js";
import { randomUUID } from "node:crypto";

export interface AcpSessionOptions {
  transport: AcpLineTransport;
  policy: EffectivePolicy;
  binding: ProviderSessionBinding;
  /** Optional human/UI approver for ask decisions. */
  onAsk?: (req: {
    capabilityId: string;
    kind?: string;
    title?: string;
    requestId: string;
    meta?: Record<string, unknown>;
  }) => Promise<AcpPermissionDecision> | AcpPermissionDecision;
  /** Emit structured authorization receipts (gateway wires OperationReceiptService). */
  onReceipt?: (receipt: {
    action: string;
    decision: "allow" | "deny" | "ask";
    capabilityId: string;
    kind?: string;
    title?: string;
    reason: string;
  }) => void;
  requestTimeoutMs?: number;
  /** When true, request plan mode after session/new. */
  planFirst?: boolean;
}

export function isMethodNotFound(e: unknown): boolean {
  if (!e) return false;
  const msg = e instanceof Error ? e.message : String(e);
  if (/-32601/.test(msg) || /method not found/i.test(msg)) return true;
  if (typeof e === "object" && e !== null && "code" in e) {
    return (e as { code: number }).code === -32601;
  }
  return false;
}

const MEDIA_TOOLS = new Set([
  "image_gen",
  "image_edit",
  "image_to_video",
  "reference_to_video",
]);

function isExitPlanMode(p: { kind?: string; title?: string; toolCallId?: string }): boolean {
  const hay = `${p.kind ?? ""} ${p.title ?? ""}`.toLowerCase();
  return (
    hay.includes("exit_plan_mode") ||
    hay.includes("exitplanmode") ||
    hay.includes("exit plan")
  );
}

function extractMediaPaths(output: unknown): string[] {
  if (!output) return [];
  if (typeof output === "string") {
    const paths: string[] = [];
    // Absolute paths ending in common media extensions
    const re =
      /(?:^|[\s"'`(])(\/(?:[^\s"'`)]+\.(?:png|jpe?g|gif|webp|mp4|webm|mov)))/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(output))) {
      if (m[1]) paths.push(m[1]);
    }
    // Relative session paths images/1.jpg videos/1.mp4
    const rel =
      /(?:^|[\s"'`(])((?:images|videos)\/[^\s"'`)]+\.(?:png|jpe?g|gif|webp|mp4|webm|mov))/gi;
    while ((m = rel.exec(output))) {
      if (m[1]) paths.push(m[1]);
    }
    return [...new Set(paths)];
  }
  if (typeof output === "object" && output !== null) {
    const o = output as Record<string, unknown>;
    for (const key of ["path", "savedPath", "saved_path", "outputPath", "file"]) {
      if (typeof o[key] === "string") return [o[key] as string];
    }
    if (Array.isArray(o.content)) {
      const found: string[] = [];
      for (const c of o.content) {
        found.push(...extractMediaPaths(c));
      }
      return found;
    }
  }
  return [];
}

export class AcpMediatedSession implements AgentSession {
  private client: AcpJsonRpcClient;
  private sessionId: string | null = null;
  private cancelled = false;
  private started = false;
  private lastPlanContent = "";
  private planFirst: boolean;
  /** Active turn sink — used to park permissions in the gateway approval UI. */
  private turnSink: RuntimeEventSink | null = null;
  readonly binding: ProviderSessionBinding;
  /** Last permission decisions (for tests / diagnostics). */
  readonly authorizationLog: PermissionBrokerResult[] = [];

  constructor(private opts: AcpSessionOptions) {
    this.binding = opts.binding;
    this.planFirst = opts.planFirst === true;
    this.client = new AcpJsonRpcClient(opts.transport, {
      requestTimeoutMs: opts.requestTimeoutMs ?? 10_000,
      onServerRequest: (method, params, respond, reject) => {
        // Observed shape: x.ai/exit_plan_mode ext with sessionId/toolCallId/planContent
        if (method === "x.ai/exit_plan_mode") {
          void this.handleExitPlanMode(params, respond, reject);
          return;
        }
        if (method === "session/request_permission") {
          const p = params as {
            sessionId?: string;
            requestId?: string;
            kind?: string;
            title?: string;
            toolCallId?: string;
          };
          if (isExitPlanMode(p)) {
            void this.handleExitPlanMode(
              {
                sessionId: p.sessionId,
                toolCallId: p.toolCallId ?? p.requestId,
                planContent: this.lastPlanContent || undefined,
                kind: p.kind,
                title: p.title ?? "exit_plan_mode",
              },
              respond,
              reject,
            );
            return;
          }
          void this.handlePermissionRequest(p, respond, reject);
          return;
        }
        reject(-32601, `Unhandled server method: ${method}`);
      },
    });
  }

  /**
   * Park an ask/plan-review decision via the turn sink → gateway runner
   * parked-approval pipeline, then wait for tasks.approve to resolve the bridge.
   */
  private async askHuman(req: {
    capabilityId: string;
    kind?: string;
    title?: string;
    requestId: string;
    meta?: Record<string, unknown>;
  }): Promise<AcpPermissionDecision> {
    if (this.opts.onAsk) {
      return this.opts.onAsk(req);
    }
    const requestId = req.requestId || randomUUID();
    if (!this.turnSink) {
      // Outside a turn: fail closed.
      return "deny";
    }
    const decisionP = waitHumanPermission(requestId);
    // Emit permission_request so runner parks waiting_approval for the UI.
    void this.turnSink({
      type: "permission_request",
      id: requestId,
      tool: req.kind ?? req.capabilityId ?? "other",
      command: req.title,
      meta: {
        permissionRequest: true,
        acpAsk: true,
        acpRequestId: requestId,
        capabilityId: req.capabilityId,
        ...(req.meta ?? {}),
      },
    });
    try {
      const human = await decisionP;
      return human;
    } catch {
      return "deny";
    }
  }

  private async handlePermissionRequest(
    p: {
      sessionId?: string;
      requestId?: string;
      kind?: string;
      title?: string;
      toolCallId?: string;
    },
    respond: (result: unknown) => void,
    reject: (code: number, message: string) => void,
  ): Promise<void> {
    try {
      const broker = resolveAcpPermission(this.opts.policy, {
        kind: p.kind,
        title: p.title,
      });
      this.authorizationLog.push(broker);
      if (broker.policyDecision === "ask") {
        const human = await this.askHuman({
          capabilityId: broker.capabilityId,
          kind: p.kind,
          title: p.title,
          requestId: p.requestId ?? p.toolCallId ?? randomUUID(),
        });
        const outcome = applyApproverOverride(broker, human);
        this.emitReceipt(broker, p, outcome);
        respond({ outcome });
        return;
      }
      const outcome = applyApproverOverride(broker, null);
      this.emitReceipt(broker, p, outcome);
      respond({ outcome });
    } catch (e) {
      reject(-32000, e instanceof Error ? e.message : String(e));
    }
  }

  private async handleExitPlanMode(
    params: unknown,
    respond: (result: unknown) => void,
    reject: (code: number, message: string) => void,
  ): Promise<void> {
    try {
      const p = params as {
        sessionId?: string;
        toolCallId?: string;
        planContent?: string;
        kind?: string;
        title?: string;
      };
      const planContent = p.planContent ?? this.lastPlanContent;
      if (planContent) this.lastPlanContent = planContent;
      const requestId = p.toolCallId ?? randomUUID();

      // Surface plan content to the UI before parking approval.
      if (planContent && this.turnSink) {
        void this.turnSink({
          type: "plan",
          content: planContent,
          status: "awaiting_approval",
        });
      }

      const human = await this.askHuman({
        capabilityId: "plan",
        kind: p.kind ?? "ExitPlan",
        title: p.title ?? "exit_plan_mode",
        requestId,
        meta: {
          planReview: true,
          planContent,
          toolCallId: p.toolCallId,
        },
      });
      // ACP exit_plan_mode response outcomes: approved | cancelled | abandoned
      if (human === "allow" || human === "allow_once") {
        respond({ outcome: "approved" });
      } else {
        respond({ outcome: "cancelled" });
      }
    } catch (e) {
      reject(-32000, e instanceof Error ? e.message : String(e));
    }
  }

  private emitReceipt(
    broker: PermissionBrokerResult,
    p: { kind?: string; title?: string },
    outcome: AcpPermissionDecision,
  ): void {
    const decisionForReceipt =
      outcome === "deny"
        ? "deny"
        : broker.policyDecision === "ask"
          ? "ask"
          : "allow";
    this.opts.onReceipt?.({
      action: `tool.permission.${broker.capabilityId}`,
      decision: decisionForReceipt,
      capabilityId: broker.capabilityId,
      kind: p.kind,
      title: p.title,
      reason: broker.reason,
    });
  }

  async start(cwd?: string, opts?: { planFirst?: boolean }): Promise<void> {
    if (this.started) return;
    if (opts?.planFirst != null) this.planFirst = opts.planFirst;
    await this.client.initialize({ name: "grok-desk", version: "0.1.2" });
    const session = await this.client.newSession({
      cwd: cwd ?? process.cwd(),
    });
    this.sessionId = session.sessionId;
    (this.binding as { providerSessionId: string }).providerSessionId =
      session.sessionId;
    this.started = true;

    if (this.planFirst) {
      try {
        await this.client.request("session/set_mode", {
          sessionId: this.sessionId,
          modeId: "plan",
        });
      } catch (e) {
        if (isMethodNotFound(e)) {
          try {
            await this.client.request("x.ai/toggle_plan_mode", {
              sessionId: this.sessionId,
            });
          } catch (e2) {
            if (!isMethodNotFound(e2)) throw e2;
          }
        } else {
          throw e;
        }
      }
    }
  }

  async runTurn(turn: TurnInput, sink: RuntimeEventSink): Promise<TurnResult> {
    if (this.cancelled) {
      return { status: "cancelled", summary: "cancelled" };
    }
    if (!this.started) {
      await this.start();
    }
    if (!this.sessionId) {
      return { status: "failed", summary: "ACP session missing" };
    }

    this.turnSink = sink;
    const unsubNotif = (() => {
      const handler = (method: string, params: unknown) => {
        if (method !== "session/update") return;
        const p = params as {
          update?: {
            sessionUpdate?: string;
            toolCallId?: string;
            title?: string;
            kind?: string;
            status?: string;
            content?: unknown;
            output?: unknown;
            rawInput?: unknown;
            citations?: unknown;
          };
        };
        const u = p.update;
        if (!u) return;

        if (u.sessionUpdate === "plan") {
          const content = String(
            (u as { content?: unknown }).content ??
              (u as { entries?: unknown }).entries ??
              "",
          );
          const status =
            (u as { status?: string }).status === "awaiting_approval"
              ? "awaiting_approval"
              : "drafting";
          this.lastPlanContent = content;
          void sink({ type: "plan", content, status });
          return;
        }

        if (
          (u.sessionUpdate === "tool_call" ||
            u.sessionUpdate === "tool_call_update") &&
          u.status === "completed"
        ) {
          const toolName = String(u.kind ?? u.title ?? "unknown");
          void sink({
            type: "tool_call",
            id: u.toolCallId ?? "tool",
            tool: toolName,
            command: u.title,
          });

          const toolLower = toolName.toLowerCase();
          if (
            MEDIA_TOOLS.has(toolLower) ||
            toolLower.includes("imagine") ||
            toolLower.includes("image_gen")
          ) {
            const paths = extractMediaPaths(u.output ?? u.content);
            for (const path of paths) {
              void sink({
                type: "artifact",
                title: path.split("/").pop() ?? path,
                path,
                kind: "media",
              });
            }
          }

          if (
            toolLower.includes("web_search") ||
            toolLower.includes("web_fetch") ||
            toolLower.includes("x_search") ||
            toolLower.includes("x_keyword")
          ) {
            const items = extractCitations(u.output ?? u.content ?? u.citations);
            if (items.length) {
              void sink({ type: "citations", items });
            }
          }
        }

        if (u.sessionUpdate === "agent_message_chunk" && u.content) {
          const text =
            typeof u.content === "string"
              ? u.content
              : typeof (u.content as { text?: string }).text === "string"
                ? (u.content as { text: string }).text
                : "";
          if (text) {
            void sink({
              type: "message",
              role: "assistant",
              text,
              channel: "text",
            });
          }
        }
      };
      this.client.on("notification", handler);
      return () => {
        this.client.off("notification", handler);
      };
    })();

    try {
      await sink({
        type: "run_progress",
        message: "ACP session prompt (policy-mediated)",
      });
      const result = await this.client.prompt(this.sessionId, turn.goal);
      const toolExecuted =
        result &&
        typeof result === "object" &&
        (result as { toolExecuted?: boolean }).toolExecuted === true;

      if (
        this.authorizationLog.some((a) => a.decision === "deny") &&
        !toolExecuted
      ) {
        await sink({
          type: "message",
          role: "system",
          text: "Tool denied by policy authorization.",
        });
      }

      await sink({
        type: "done",
        summary: toolExecuted
          ? "ACP turn complete (tool allowed)"
          : "ACP turn complete",
      });
      return {
        status: "done",
        summary: "acp mediated turn",
        providerSessionId: this.sessionId,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await sink({ type: "error", message, code: "internal" });
      return { status: "failed", summary: message };
    } finally {
      this.turnSink = null;
      unsubNotif();
    }
  }

  /**
   * Mid-run interjection. When clientMutationId is provided it is included in
   * the ACP params so a reload replay of the same mutation is provider-dedupable.
   * Returns true only after a successful request ack (not before).
   */
  async interject(
    text: string,
    opts?: { clientMutationId?: string },
  ): Promise<boolean> {
    if (!this.sessionId) return false;
    const mutationId = opts?.clientMutationId?.trim() || undefined;
    for (const method of [
      "x.ai/session/interjection",
      "x.ai/interject",
      "x.ai/queue/interject",
    ]) {
      try {
        await this.client.request(method, {
          sessionId: this.sessionId,
          text,
          newText: text,
          ...(mutationId
            ? { clientMutationId: mutationId, mutationId }
            : {}),
        });
        // Delivered only after provider ack of this request.
        return true;
      } catch (e) {
        if (isMethodNotFound(e)) continue;
        throw e;
      }
    }
    return false;
  }

  async compact(): Promise<boolean> {
    if (!this.sessionId) return false;
    try {
      await this.client.request("x.ai/compact_conversation", {
        sessionId: this.sessionId,
      });
      return true;
    } catch (e) {
      if (isMethodNotFound(e)) return false;
      throw e;
    }
  }

  /**
   * Observed shape from CLI: { rewind_points: [{ prompt_index, created_at,
   * num_file_snapshots, has_file_changes, prompt_preview? }] }
   */
  async rewindPoints(): Promise<Array<{
    id: string;
    label?: string;
    files?: string[];
    hasFileChanges?: boolean;
  }> | null> {
    if (!this.sessionId) return null;
    try {
      const res = (await this.client.request("x.ai/rewind/points", {
        sessionId: this.sessionId,
      })) as {
        rewind_points?: Array<Record<string, unknown>>;
        rewindPoints?: Array<Record<string, unknown>>;
        points?: Array<Record<string, unknown>>;
      };
      const raw =
        res?.rewind_points ?? res?.rewindPoints ?? res?.points ?? null;
      if (!Array.isArray(raw)) return null;
      return raw.map((p) => {
        const idx = p.prompt_index ?? p.promptIndex ?? p.id;
        return {
          id: String(idx),
          label:
            typeof p.prompt_preview === "string"
              ? p.prompt_preview
              : typeof p.promptPreview === "string"
                ? p.promptPreview
                : typeof p.summary === "string"
                  ? p.summary
                  : undefined,
          hasFileChanges: Boolean(
            p.has_file_changes ?? p.hasFileChanges ?? false,
          ),
          files: Array.isArray(p.files)
            ? (p.files as string[])
            : Array.isArray(p.reverted_files)
              ? (p.reverted_files as string[])
              : undefined,
        };
      });
    } catch (e) {
      if (isMethodNotFound(e)) return null;
      throw e;
    }
  }

  async rewindTo(pointId: string): Promise<boolean> {
    if (!this.sessionId) return false;
    try {
      const promptIndex = Number(pointId);
      await this.client.request("x.ai/rewind/execute", {
        sessionId: this.sessionId,
        pointId,
        prompt_index: Number.isFinite(promptIndex) ? promptIndex : pointId,
        promptIndex: Number.isFinite(promptIndex) ? promptIndex : pointId,
      });
      return true;
    } catch (e) {
      if (isMethodNotFound(e)) return false;
      throw e;
    }
  }

  async cancel(_reason: string): Promise<void> {
    this.cancelled = true;
    try {
      if (this.sessionId && this.started) {
        await Promise.race([
          this.client.cancel(this.sessionId).catch(() => {}),
          new Promise<void>((r) => setTimeout(r, 500)),
        ]);
      }
    } finally {
      await this.client.close().catch(() => {});
    }
  }
}

function extractCitations(
  raw: unknown,
): Array<{
  url: string;
  title?: string;
  snippet?: string;
  source?: "web" | "x" | "other";
}> {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string" && /^https?:\/\//.test(item)) {
          return { url: item, source: "web" as const };
        }
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          const url = String(o.url ?? o.link ?? "");
          if (!url) return null;
          return {
            url,
            title: typeof o.title === "string" ? o.title : undefined,
            snippet:
              typeof o.snippet === "string"
                ? o.snippet
                : typeof o.description === "string"
                  ? o.description
                  : undefined,
            source: /x\.com|twitter/i.test(url)
              ? ("x" as const)
              : ("web" as const),
          };
        }
        return null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .slice(0, 12);
  }
  if (typeof raw === "string") {
    const urls = raw.match(/https?:\/\/[^\s)"']+/g) ?? [];
    return urls.slice(0, 12).map((url) => ({
      url,
      source: /x\.com|twitter/i.test(url) ? ("x" as const) : ("web" as const),
    }));
  }
  return [];
}

export function createAcpBinding(
  modelId: string,
  providerSessionId?: string,
): ProviderSessionBinding {
  return {
    providerId: "grok",
    providerSessionId: providerSessionId ?? `acp-pending-${Date.now()}`,
    modelId,
    createdAt: new Date().toISOString(),
  };
}

// Keep SessionInput import for consumers that re-export createSession types.
export type { SessionInput };
