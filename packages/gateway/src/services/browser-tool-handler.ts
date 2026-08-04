/**
 * Browser tool execution path for TaskRunner (Phase 6 extract).
 * Host is sole policy owner for TestEngine-mediated browser tools.
 * Emits structured operation receipts when OperationReceiptService is provided.
 */
import type { BrowserToolName } from "@grokdesk/shared";
import type { NormalizedEngineEvent } from "../engine-types.js";
import type { HostBridge, BrowserExecTool } from "../host-bridge.js";
import type { TaskService } from "./tasks.js";
import type { AuditService } from "./audit.js";
import type { EngineAdapter } from "../engine-types.js";
import type { OperationReceiptService } from "./operation-receipts.js";

export type EngineOwnedBrowserCall = {
  id: string;
  tool: BrowserToolName;
  url: string;
  browserSessionId: string;
  runAttemptId: string | null;
};

export type BrowserToolRequestOutcome = {
  flow: "continue" | "abort";
  confirmedOpen: boolean;
};

export function engineOwnedBrowserCallFromRequest(input: {
  event: Extract<NormalizedEngineEvent, { type: "tool_request" }>;
  browserSessionId: string;
  runAttemptId?: string | null;
}): EngineOwnedBrowserCall {
  const meta = input.event.meta;
  const target = meta?.url ?? meta?.href ?? meta?.path;
  return {
    id: input.event.id,
    tool: input.event.tool as BrowserToolName,
    url: typeof target === "string" ? target : "",
    browserSessionId: input.browserSessionId,
    runAttemptId: input.runAttemptId ?? null,
  };
}

/**
 * Finalize an engine-owned browser call only when its exact tool_result arrives.
 * The request is merely intent; success/provider attribution belongs here.
 */
export function recordEngineOwnedBrowserToolResult(input: {
  taskId: string;
  call: EngineOwnedBrowserCall;
  event: Extract<NormalizedEngineEvent, { type: "tool_result" }>;
  tasks: TaskService;
  audit: AuditService;
  operationReceipts?: OperationReceiptService | null;
}): { confirmedOpen: boolean } {
  const { taskId, call, event, tasks, audit, operationReceipts } = input;
  const success = event.ok === true;
  tasks.appendEvent(taskId, "tool_result", {
    id: event.id,
    tool: call.tool,
    ok: success,
    output: event.output,
    browserSessionId: call.browserSessionId,
    ...(success ? { browserProvider: "desk-browser" } : {}),
  });
  audit.append({
    taskId,
    action: "browser_tool",
    detail: {
      tool: call.tool,
      url: call.url || undefined,
      ok: success,
      executedBy: "engine_mcp",
      browserSessionId: call.browserSessionId,
    },
    decision: success ? "allow" : "deny",
  });
  operationReceipts?.append({
    taskId,
    runAttemptId: call.runAttemptId,
    action: `tool:${call.tool}`,
    decision: success ? "allow" : "deny",
    effect: success ? "provider_executed" : "provider_failed",
    detail: {
      tool: call.tool,
      url: call.url || null,
      executedBy: "engine_mcp",
      browserSessionId: call.browserSessionId,
      ok: success,
      ...(success ? { browserProvider: "desk-browser" } : {}),
    },
    correlationId: event.id,
  });
  return { confirmedOpen: success && call.tool === "browser_open" };
}

export async function handleBrowserToolRequest(input: {
  taskId: string;
  event: Extract<NormalizedEngineEvent, { type: "tool_request" }>;
  browserSessionId: string;
  tasks: TaskService;
  audit: AuditService;
  hostBridge: HostBridge;
  engine: EngineAdapter;
  operationReceipts?: OperationReceiptService | null;
  runAttemptId?: string | null;
}): Promise<BrowserToolRequestOutcome> {
  const {
    taskId,
    event,
    browserSessionId,
    tasks,
    audit,
    hostBridge,
    engine,
    operationReceipts,
    runAttemptId,
  } = input;
  const task = tasks.get(taskId);
  if (!task || task.status === "cancelled") {
    return { flow: "abort", confirmedOpen: false };
  }

  const tool = event.tool as BrowserToolName;
  const url = String(event.meta?.url ?? event.meta?.href ?? "");

  // Grok + desk-browser MCP: host already authorized and executed.
  // Do not record provider execution here: this event is request intent. The
  // correlated tool_result is the only truthful execution receipt.
  if (engine.executesOwnTools) {
    return { flow: "continue", confirmedOpen: false };
  }

  try {
    const result = await hostBridge.browserExec({
      taskId: browserSessionId,
      tool: tool as BrowserExecTool,
      args: {
        ...(event.meta ?? {}),
        ...(url ? { url } : {}),
      },
    });
    tasks.appendEvent(taskId, "tool_result", {
      id: event.id,
      tool,
      ok: result.ok,
      output: result.output,
      url: result.url,
      screenshot: result.screenshot,
      title: result.title,
      browserSessionId,
      ...(result.ok ? { browserProvider: "desk-browser" } : {}),
    });
    audit.append({
      taskId,
      action: "browser_tool",
      detail: {
        tool,
        url: result.url ?? (url || undefined),
        ok: result.ok,
        executedBy: "host",
        browserSessionId,
      },
      decision: result.ok ? "allow" : "deny",
    });
    operationReceipts?.append({
      taskId,
      runAttemptId: runAttemptId ?? null,
      action: `tool:${tool}`,
      decision: result.ok ? "allow" : "deny",
      effect: result.ok ? "executed" : "host_failed",
      detail: {
        tool,
        url: result.url ?? (url || null),
        executedBy: "host",
        browserSessionId,
        ok: result.ok,
        ...(result.ok ? { browserProvider: "desk-browser" } : {}),
      },
      correlationId: event.id,
    });
    const after = tasks.get(taskId);
    if (after?.status === "waiting_approval") {
      tasks.setStatus(taskId, "running");
    }
    return {
      flow: "continue",
      confirmedOpen: result.ok && tool === "browser_open",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    tasks.appendEvent(taskId, "tool_result", {
      id: event.id,
      tool,
      ok: false,
      output: message,
    });
    operationReceipts?.append({
      taskId,
      runAttemptId: runAttemptId ?? null,
      action: `tool:${tool}`,
      decision: "error",
      effect: "exception",
      detail: {
        tool,
        url: url || null,
        executedBy: "host",
        browserSessionId,
        // Message only — no stack / secrets
        reason: message.slice(0, 500),
      },
      correlationId: event.id,
    });
    return { flow: "continue", confirmedOpen: false };
  }
}
