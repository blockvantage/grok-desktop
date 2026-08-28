/**
 * Agent Client Protocol (ACP) newline-delimited JSON-RPC 2.0 framing.
 *
 * Transport-agnostic core: works over any duplex of write-line / read-line
 * callbacks. Used by AcpStdioClient against real `grok agent stdio` or a
 * fake peer in tests. Does not spend model credits by itself.
 */
import { EventEmitter } from "node:events";
import { grokAcpInitializeParams } from "./client-info.js";

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcError;

export interface AcpInitializeResult {
  protocolVersion: number;
  serverInfo?: { name?: string; version?: string };
  agentVersion?: string;
  capabilities?: {
    loadSession?: boolean;
    promptCapabilities?: Record<string, boolean>;
  };
  sessionCapabilities?: {
    close?: boolean;
    list?: boolean;
    resume?: boolean;
    load?: boolean;
  };
  availableCommands?: string[];
  /** Forward-compat bag (hooks, x.ai/capabilities, statusLine, …). */
  _meta?: Record<string, unknown>;
}

export interface AcpPermissionRequest {
  sessionId: string;
  requestId: string;
  toolCallId?: string;
  title?: string;
  kind?: string;
  raw?: unknown;
}

export type AcpPermissionDecision = "allow" | "deny" | "allow_once";

export interface AcpSpawnMeta {
  grokHome: string | null;
  isolateGrokHome: boolean;
  env: NodeJS.ProcessEnv;
}

export interface AcpLineTransport {
  writeLine(line: string): void;
  onLine(handler: (line: string) => void): () => void;
  close(): void | Promise<void>;
  /** Set by the live ACP factory from the env that was actually spawned. */
  spawnMeta?: AcpSpawnMeta;
}

/**
 * Reject individual ACP JSON-RPC lines above this size (DoS / memory guard).
 * Matches gateway CLI framing so a runaway agent cannot balloon Desk memory.
 */
export const ACP_MAX_LINE_BYTES = 2 * 1024 * 1024; // 2 MiB

/** Soft cap on concurrent client→server RPC waiters. */
export const ACP_MAX_PENDING_RPC = 64;

/**
 * Pure line codec: parse/serialize JSON-RPC messages (one object per line).
 */
export function encodeJsonRpc(msg: JsonRpcMessage): string {
  return JSON.stringify(msg);
}

export function decodeJsonRpcLine(line: string): JsonRpcMessage {
  const trimmed = line.trim();
  if (!trimmed) throw new Error("empty JSON-RPC line");
  if (Buffer.byteLength(trimmed, "utf8") > ACP_MAX_LINE_BYTES) {
    throw new Error(`ACP line too large (max ${ACP_MAX_LINE_BYTES} bytes)`);
  }
  const obj = JSON.parse(trimmed) as Record<string, unknown>;
  if (obj.jsonrpc !== "2.0") throw new Error("invalid jsonrpc version");
  return obj as unknown as JsonRpcMessage;
}

/**
 * In-process duplex for unit tests (no child process).
 */
export class MemoryLineDuplex {
  private aHandlers = new Set<(line: string) => void>();
  private bHandlers = new Set<(line: string) => void>();

  /** Side A writes → B receives */
  readonly a: AcpLineTransport = {
    writeLine: (line) => {
      for (const h of this.bHandlers) h(line);
    },
    onLine: (handler) => {
      this.aHandlers.add(handler);
      return () => this.aHandlers.delete(handler);
    },
    close: () => {
      this.aHandlers.clear();
    },
  };

  /** Side B writes → A receives */
  readonly b: AcpLineTransport = {
    writeLine: (line) => {
      for (const h of this.aHandlers) h(line);
    },
    onLine: (handler) => {
      this.bHandlers.add(handler);
      return () => this.bHandlers.delete(handler);
    },
    close: () => {
      this.bHandlers.clear();
    },
  };
}

/**
 * JSON-RPC client over line transport with request correlation and
 * server-request handling (e.g. permission prompts).
 */
export class AcpJsonRpcClient extends EventEmitter {
  private nextId = 1;
  private pending = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private unsub: (() => void) | null = null;
  private closed = false;
  private buffer = "";

  constructor(
    private transport: AcpLineTransport,
    private opts?: {
      requestTimeoutMs?: number;
      onServerRequest?: (
        method: string,
        params: unknown,
        respond: (result: unknown) => void,
        reject: (code: number, message: string) => void,
      ) => void;
    },
  ) {
    super();
    // Transports may deliver either complete lines (MemoryLineDuplex) or
    // raw chunks that need newline splitting (child stdio).
    this.unsub = transport.onLine((chunk) => this.onRawChunk(chunk));
  }

  private onRawChunk(chunk: string): void {
    // Complete JSON object without trailing newline (in-memory duplex).
    if (chunk.includes("\n") || chunk.includes("\r")) {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer, "utf8") > ACP_MAX_LINE_BYTES) {
        this.buffer = "";
        this.emit(
          "parse_error",
          new Error(`ACP line too large (max ${ACP_MAX_LINE_BYTES} bytes)`),
        );
        return;
      }
      const parts = this.buffer.split(/\r?\n/);
      this.buffer = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.trim()) continue;
        this.dispatchLine(line);
      }
      return;
    }
    // Flush any prior partial, then treat this write as one full message.
    if (this.buffer.trim()) {
      this.dispatchLine(this.buffer);
      this.buffer = "";
    }
    if (chunk.trim()) this.dispatchLine(chunk);
  }

  private dispatchLine(line: string): void {
    try {
      this.onMessage(decodeJsonRpcLine(line));
    } catch (e) {
      this.emit(
        "parse_error",
        e instanceof Error ? e : new Error(String(e)),
      );
    }
  }

  private onMessage(msg: JsonRpcMessage): void {
    if ("method" in msg && !("result" in msg) && !("error" in msg)) {
      // Request or notification from server
      if ("id" in msg && msg.id != null) {
        const req = msg as JsonRpcRequest;
        const respond = (result: unknown) => {
          this.transport.writeLine(
            encodeJsonRpc({
              jsonrpc: "2.0",
              id: req.id,
              result,
            }),
          );
        };
        const reject = (code: number, message: string) => {
          this.transport.writeLine(
            encodeJsonRpc({
              jsonrpc: "2.0",
              id: req.id,
              error: { code, message },
            }),
          );
        };
        if (this.opts?.onServerRequest) {
          this.opts.onServerRequest(req.method, req.params, respond, reject);
        } else {
          reject(-32601, `Method not handled: ${req.method}`);
        }
      } else {
        this.emit("notification", (msg as JsonRpcNotification).method, (msg as JsonRpcNotification).params);
      }
      return;
    }

    if ("id" in msg && msg.id != null) {
      const key = String(msg.id);
      const waiter = this.pending.get(key);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(key);
      if ("error" in msg && msg.error) {
        waiter.reject(
          new Error(
            `JSON-RPC error ${msg.error.code}: ${msg.error.message}`,
          ),
        );
      } else {
        waiter.resolve((msg as JsonRpcSuccess).result);
      }
    }
  }

  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("ACP client closed"));
    if (this.pending.size >= ACP_MAX_PENDING_RPC) {
      return Promise.reject(
        new Error(
          `ACP pending RPC cap exceeded (max ${ACP_MAX_PENDING_RPC})`,
        ),
      );
    }
    const id = this.nextId++;
    const key = String(id);
    const ms = timeoutMs ?? this.opts?.requestTimeoutMs ?? 10_000;
    const msg: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`ACP RPC timeout method=${method} id=${id}`));
      }, ms);
      this.pending.set(key, { resolve, reject, timer });
      try {
        this.transport.writeLine(encodeJsonRpc(msg));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    const msg: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    };
    this.transport.writeLine(encodeJsonRpc(msg));
  }

  async initialize(clientInfo?: {
    name?: string;
    version?: string;
  }): Promise<AcpInitializeResult> {
    const result = (await this.request(
      "initialize",
      grokAcpInitializeParams(clientInfo),
    )) as AcpInitializeResult;
    if (
      !result ||
      typeof result.protocolVersion !== "number" ||
      result.protocolVersion < 1
    ) {
      throw new Error("ACP initialize: invalid protocolVersion");
    }
    this.notify("initialized", {});
    return result;
  }

  async newSession(params?: {
    cwd?: string;
    mcpServers?: unknown[];
    _meta?: Record<string, unknown>;
  }): Promise<{ sessionId: string }> {
    const result = (await this.request("session/new", {
      cwd: params?.cwd,
      ...(params ?? {}),
      // CLI 1.0.5 requires this field even when empty (`missing field mcpServers`).
      mcpServers: params?.mcpServers ?? [],
      _meta: {
        clientStatusLine: true,
        ...(params?._meta ?? {}),
      },
    })) as {
      sessionId?: string;
    };
    if (!result?.sessionId) throw new Error("ACP session/new missing sessionId");
    return { sessionId: result.sessionId };
  }

  async prompt(
    sessionId: string,
    prompt: string,
  ): Promise<{ stopReason?: string }> {
    const result = (await this.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt }],
    })) as { stopReason?: string };
    return result ?? {};
  }

  async cancel(sessionId: string): Promise<void> {
    await this.request("session/cancel", { sessionId });
  }

  async resumeSession(sessionId: string): Promise<{ sessionId: string }> {
    const result = (await this.request("session/resume", { sessionId })) as {
      sessionId?: string;
    };
    return { sessionId: result?.sessionId ?? sessionId };
  }

  async loadSession(
    sessionId: string,
  ): Promise<{ sessionId: string; raw: unknown }> {
    const result = (await this.request("session/load", { sessionId })) as {
      sessionId?: string;
    };
    return { sessionId: result?.sessionId ?? sessionId, raw: result };
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.request("session/close", { sessionId });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [, w] of this.pending) {
      clearTimeout(w.timer);
      w.reject(new Error("ACP client closed"));
    }
    this.pending.clear();
    this.unsub?.();
    this.unsub = null;
    await this.transport.close();
  }
}

/**
 * Minimal fake ACP agent peer for conformance tests.
 * Handles initialize, session/new, session/prompt, session/cancel,
 * and can emit a permission request mid-prompt.
 *
 * When requirePermission is true, the prompt waits for the client's
 * session/request_permission *response* before executing the tool or
 * completing the turn. Denied permissions never execute the tool.
 */
export type FakeAcpAgentState = {
  /** Permission outcomes applied during prompts (allow/deny/allow_once). */
  permissionOutcomes: AcpPermissionDecision[];
  /** Tool effects that actually ran (only when permission allowed). */
  toolsExecuted: Array<{ kind: string; title: string; sessionId: string }>;
  /** Whether a pending permission is awaiting client response. */
  pendingPermissionIds: Set<string>;
  /** Methods received from the client (for extension tests). */
  requests: Array<{ method: string; params?: unknown }>;
  /** PreToolUse hook outcomes. Unknown / error fail open as allow. */
  hookOutcomes: Array<"allow" | "deny">;
};

export function attachFakeAcpAgent(
  transport: AcpLineTransport,
  opts?: {
    requirePermission?: boolean;
    permissionKind?: string;
    permissionTitle?: string;
    /** Emit a SessionStatus update before completing the prompt. */
    emitSessionStatus?: boolean;
    /** Emit a PendingInteraction session/update before completing the prompt. */
    emitPendingInteraction?: {
      id: string;
      kind: string;
      title: string;
    };
    /** Emit a GoalUpdated session/update before completing the prompt. */
    emitGoalUpdated?: {
      objective?: string;
      progress?: string;
    };
    /** Emit a WorkflowUpdated session/update before completing the prompt. */
    emitWorkflowUpdated?: Record<string, unknown>;
    /** Emit MemoryUpdated / MemoryRecalled session/update before completing. */
    emitMemoryUpdated?: {
      sessionUpdate?: "MemoryUpdated" | "MemoryRecalled";
      title?: string;
      content?: string;
    };
    emitMonitorEvent?: Record<string, unknown>;
    emitScheduledTask?: Record<string, unknown>;
    /**
     * Advertise initialize._meta["x.ai/hooks"] so Desk registers groups
     * on session/new. `true` enables blocking PreToolUse.
     */
    advertiseHooks?:
      | boolean
      | { blockingEvents?: boolean; decisions?: boolean; stopSignals?: boolean };
    /** Reverse-RPC x.ai/hooks/run before the prompt tool / permission path. */
    requireHook?: boolean;
    hookEventName?: string;
    hookToolName?: string;
    hookToolInput?: Record<string, unknown>;
    /** Per-method responder; throw {code:-32601} to simulate method-not-found. */
    respond?: (method: string, params?: unknown) => unknown;
  },
): { dispose: () => void; state: FakeAcpAgentState } {
  let sessions = 0;
  const state: FakeAcpAgentState = {
    permissionOutcomes: [],
    toolsExecuted: [],
    pendingPermissionIds: new Set(),
    requests: [],
    hookOutcomes: [],
  };
  /** pending RPC id of hook run → waiters (fail-open on error/unknown). */
  const hookWaiters = new Map<
    string,
    { continue: (decision: "allow" | "deny") => void }
  >();

  const interpretFakeHookResult = (
    result: unknown,
    isError: boolean,
  ): "allow" | "deny" => {
    if (isError) return "allow";
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return "allow";
    }
    const obj = result as Record<string, unknown>;
    const nested =
      obj.hookSpecificOutput &&
      typeof obj.hookSpecificOutput === "object" &&
      !Array.isArray(obj.hookSpecificOutput)
        ? (obj.hookSpecificOutput as Record<string, unknown>)
        : obj;
    const raw = nested.decision ?? nested.permissionDecision;
    return raw === "deny" ? "deny" : "allow";
  };

  /** pending RPC id of permission request → waiters */
  const permWaiters = new Map<
    string,
    {
      resolve: (decision: AcpPermissionDecision) => void;
      promptReply: (result: unknown) => void;
      sessionId: string;
      kind: string;
      title: string;
    }
  >();

  const unsub = transport.onLine((line) => {
    let msg: JsonRpcMessage;
    try {
      msg = decodeJsonRpcLine(line);
    } catch {
      return;
    }

    // Client response to our permission request or hook run
    if (
      "id" in msg &&
      msg.id != null &&
      !("method" in msg) &&
      ("result" in msg || "error" in msg)
    ) {
      const key = String(msg.id);
      const hookWaiter = hookWaiters.get(key);
      if (hookWaiter) {
        hookWaiters.delete(key);
        const isError = "error" in msg && Boolean(msg.error);
        const decision = interpretFakeHookResult(
          "result" in msg ? msg.result : undefined,
          isError,
        );
        state.hookOutcomes.push(decision);
        hookWaiter.continue(decision);
        return;
      }
      const waiter = permWaiters.get(key);
      if (waiter) {
        permWaiters.delete(key);
        state.pendingPermissionIds.delete(key);
        let decision: AcpPermissionDecision = "deny";
        if ("result" in msg && msg.result && typeof msg.result === "object") {
          const outcome = (msg.result as { outcome?: string }).outcome;
          if (
            outcome === "allow" ||
            outcome === "deny" ||
            outcome === "allow_once"
          ) {
            decision = outcome;
          }
        }
        state.permissionOutcomes.push(decision);
        if (decision === "allow" || decision === "allow_once") {
          state.toolsExecuted.push({
            kind: waiter.kind,
            title: waiter.title,
            sessionId: waiter.sessionId,
          });
          // Notify client that tool ran (as notification for tests).
          transport.writeLine(
            encodeJsonRpc({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: waiter.sessionId,
                update: {
                  sessionUpdate: "tool_call",
                  toolCallId: `tool-${waiter.sessionId}`,
                  title: waiter.title,
                  kind: waiter.kind,
                  status: "completed",
                },
              },
            }),
          );
        }
        waiter.promptReply({
          stopReason: "end_turn",
          permissionOutcome: decision,
          toolExecuted: decision === "allow" || decision === "allow_once",
        });
      }
      return;
    }

    if (!("method" in msg) || !("id" in msg) || msg.id == null) return;
    const req = msg as JsonRpcRequest;
    state.requests.push({ method: req.method, params: req.params });
    const reply = (result: unknown) => {
      transport.writeLine(
        encodeJsonRpc({ jsonrpc: "2.0", id: req.id, result }),
      );
    };
    const replyErr = (code: number, message: string) => {
      transport.writeLine(
        encodeJsonRpc({
          jsonrpc: "2.0",
          id: req.id,
          error: { code, message },
        }),
      );
    };

    if (opts?.respond) {
      try {
        const result = opts.respond(req.method, req.params);
        // Still handle core methods if responder returns undefined and we need defaults.
        if (result !== undefined) {
          reply(result);
          return;
        }
      } catch (e) {
        const code =
          typeof e === "object" && e && "code" in e
            ? Number((e as { code: number }).code)
            : -32000;
        const message =
          e instanceof Error
            ? e.message
            : typeof e === "object" && e && "message" in e
              ? String((e as { message: unknown }).message)
              : String(e);
        replyErr(code, message);
        return;
      }
    }

    switch (req.method) {
      case "initialize": {
        const hooksOpt = opts?.advertiseHooks;
        const hooksMeta =
          hooksOpt === true
            ? { blockingEvents: true, decisions: true, stopSignals: true }
            : hooksOpt && typeof hooksOpt === "object"
              ? {
                  blockingEvents: hooksOpt.blockingEvents === true,
                  decisions: hooksOpt.decisions === true,
                  stopSignals: hooksOpt.stopSignals === true,
                }
              : null;
        reply({
          protocolVersion: 1,
          serverInfo: { name: "fake-acp", version: "0.0.1" },
          capabilities: {
            loadSession: true,
            promptCapabilities: { image: false },
          },
          sessionCapabilities: {
            resume: true,
            load: true,
            close: true,
          },
          ...(hooksMeta
            ? { _meta: { "x.ai/hooks": hooksMeta } }
            : {}),
        });
        break;
      }
      case "session/new": {
        sessions += 1;
        reply({ sessionId: `fake-sess-${sessions}` });
        break;
      }
      case "session/set_mode":
        reply({ ok: true });
        break;
      case "session/resume":
      case "session/load": {
        const params = req.params as { sessionId?: string };
        reply({
          sessionId: params?.sessionId ?? `fake-sess-${sessions}`,
        });
        break;
      }
      case "session/close":
        reply({ ok: true });
        break;
      case "session/prompt": {
        const params = req.params as { sessionId?: string };
        const sessionId = params?.sessionId ?? "unknown";
        const kind = opts?.permissionKind ?? "shell";
        const title = opts?.permissionTitle ?? "Run shell";
        if (opts?.requireHook) {
          const hookReqId = 8000 + sessions;
          const key = String(hookReqId);
          hookWaiters.set(key, {
            continue: (decision) => {
              if (decision === "deny") {
                reply({
                  stopReason: "end_turn",
                  toolExecuted: false,
                  hookDenied: true,
                });
                return;
              }
              if (opts?.requirePermission) {
                const permReqId = 9000 + sessions;
                const permKey = String(permReqId);
                state.pendingPermissionIds.add(permKey);
                permWaiters.set(permKey, {
                  resolve: () => {},
                  promptReply: reply,
                  sessionId,
                  kind,
                  title,
                });
                transport.writeLine(
                  encodeJsonRpc({
                    jsonrpc: "2.0",
                    id: permReqId,
                    method: "session/request_permission",
                    params: {
                      sessionId,
                      requestId: `perm-${sessions}`,
                      toolCallId: `tool-${sessions}`,
                      title,
                      kind,
                    },
                  }),
                );
                return;
              }
              state.toolsExecuted.push({ kind, title, sessionId });
              transport.writeLine(
                encodeJsonRpc({
                  jsonrpc: "2.0",
                  method: "session/update",
                  params: {
                    sessionId,
                    update: {
                      sessionUpdate: "tool_call",
                      toolCallId: `tool-${sessionId}`,
                      title,
                      kind,
                      status: "completed",
                    },
                  },
                }),
              );
              reply({ stopReason: "end_turn", toolExecuted: true });
            },
          });
          transport.writeLine(
            encodeJsonRpc({
              jsonrpc: "2.0",
              id: hookReqId,
              method: "x.ai/hooks/run",
              params: {
                sessionId,
                hookEventName: opts.hookEventName ?? "PreToolUse",
                toolName: opts.hookToolName ?? "Bash",
                toolInput: opts.hookToolInput ?? { command: "ls" },
              },
            }),
          );
          break;
        }
        if (opts?.requirePermission) {
          const kind = opts.permissionKind ?? "shell";
          const title = opts.permissionTitle ?? "Run shell";
          const permReqId = 9000 + sessions;
          const key = String(permReqId);
          state.pendingPermissionIds.add(key);
          permWaiters.set(key, {
            resolve: () => {},
            promptReply: reply,
            sessionId,
            kind,
            title,
          });
          transport.writeLine(
            encodeJsonRpc({
              jsonrpc: "2.0",
              id: permReqId,
              method: "session/request_permission",
              params: {
                sessionId,
                requestId: `perm-${sessions}`,
                toolCallId: `tool-${sessions}`,
                title,
                kind,
              },
            }),
          );
          // Do not reply to prompt until permission response arrives.
        } else {
          if (opts?.emitSessionStatus) {
            transport.writeLine(
              encodeJsonRpc({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: "session_status",
                    schema_version: 1,
                    model: { display_name: "Grok 4.5" },
                    workspace: { branch: "main" },
                  },
                },
              }),
            );
          }
          if (opts?.emitPendingInteraction) {
            const pending = opts.emitPendingInteraction;
            transport.writeLine(
              encodeJsonRpc({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: "PendingInteraction",
                    id: pending.id,
                    kind: pending.kind,
                    title: pending.title,
                  },
                },
              }),
            );
          }
          if (opts?.emitGoalUpdated) {
            const goal = opts.emitGoalUpdated;
            transport.writeLine(
              encodeJsonRpc({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: "GoalUpdated",
                    ...(goal.objective ? { objective: goal.objective } : {}),
                    ...(goal.progress ? { progress: goal.progress } : {}),
                  },
                },
              }),
            );
          }
          if (opts?.emitWorkflowUpdated) {
            transport.writeLine(
              encodeJsonRpc({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: "WorkflowUpdated",
                    ...opts.emitWorkflowUpdated,
                  },
                },
              }),
            );
          }
          if (opts?.emitMemoryUpdated) {
            const mem = opts.emitMemoryUpdated;
            transport.writeLine(
              encodeJsonRpc({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: mem.sessionUpdate ?? "MemoryUpdated",
                    ...(mem.title ? { title: mem.title } : {}),
                    ...(mem.content ? { content: mem.content } : {}),
                  },
                },
              }),
            );
          }
          if (opts?.emitMonitorEvent) {
            transport.writeLine(
              encodeJsonRpc({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: "MonitorEvent",
                    ...opts.emitMonitorEvent,
                  },
                },
              }),
            );
          }
          if (opts?.emitScheduledTask) {
            transport.writeLine(
              encodeJsonRpc({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: "ScheduledTaskCreated",
                    ...opts.emitScheduledTask,
                  },
                },
              }),
            );
          }
          reply({ stopReason: "end_turn", toolExecuted: false });
        }
        break;
      }
      case "session/cancel":
        reply({ ok: true });
        break;
      case "x.ai/session/interjection":
      case "x.ai/interject":
      case "x.ai/queue/interject":
      case "x.ai/compact_conversation":
      case "x.ai/rewind/points":
      case "x.ai/rewind/execute":
      case "x.ai/toggle_plan_mode":
      case "x.ai/memory/flush":
      case "x.ai/memory/rewrite":
      case "x.ai/session/search":
      case "x.ai/sessions/search":
      case "x.ai/session/list":
      case "x.ai/sessions/list":
        // Default: method not found so callers test degrade paths unless
        // opts.respond handles them.
        replyErr(-32601, `Method not found: ${req.method}`);
        break;
      default:
        replyErr(-32601, `Method not found: ${req.method}`);
    }
  });
  return {
    dispose: () => {
      unsub();
      permWaiters.clear();
      hookWaiters.clear();
    },
    state,
  };
}
