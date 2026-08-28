/**
 * ACP client hooks (Phase 4.1).
 *
 * Register groups on session/new only after initialize._meta["x.ai/hooks"].
 * Reverse RPC: x.ai/hooks/run (PreToolUse, blocking). Other events:
 * x.ai/hooks/event (observe). Only an explicit deny blocks; unknown
 * decisions, missing fields, and transport errors fail open.
 */

import { evaluateToolRequest, type ToolName, type ToolRequest } from "./policy.js";
import type { PolicySnapshot } from "./types.js";

export const CLIENT_HOOK_RUN_METHOD = "x.ai/hooks/run";
export const CLIENT_HOOK_EVENT_METHOD = "x.ai/hooks/event";
/** Agent-side wait for blocking PreToolUse (CLI default). */
export const CLIENT_HOOK_RUN_TIMEOUT_MS = 30_000;
/** Agent-side cap; longer waits still fail open. */
export const CLIENT_HOOK_RUN_TIMEOUT_CAP_MS = 300_000;

export type ClientHookEventName = "PreToolUse" | "Stop" | "unknown";

export type ClientHookRunInput = {
  hookEventName: ClientHookEventName;
  toolName: string;
  toolInput: Record<string, unknown>;
};

export type ClientHookDecision =
  | { decision: "deny"; reason: string }
  | { decision: "allow"; updatedInput?: Record<string, unknown> };

/** True when the agent advertised client hooks on initialize. */
export function agentAdvertisesClientHooks(initMeta: unknown): boolean {
  if (!initMeta || typeof initMeta !== "object" || Array.isArray(initMeta)) {
    return false;
  }
  const hooks = (initMeta as Record<string, unknown>)["x.ai/hooks"];
  return Boolean(hooks && typeof hooks === "object" && !Array.isArray(hooks));
}

export function agentAdvertisesBlockingHookEvents(initMeta: unknown): boolean {
  if (!agentAdvertisesClientHooks(initMeta)) return false;
  const hooks = (initMeta as Record<string, unknown>)["x.ai/hooks"] as Record<
    string,
    unknown
  >;
  return hooks.blockingEvents === true;
}

/** session/new _meta fragment. Null when the agent did not advertise hooks. */
export function sessionNewClientHooksMeta(
  initMeta: unknown,
): Record<string, unknown> | null {
  if (!agentAdvertisesClientHooks(initMeta)) return null;
  const blocking = agentAdvertisesBlockingHookEvents(initMeta);
  return {
    "x.ai/hooks": {
      groups: [
        {
          id: "grok-desk-policy",
          events: ["PreToolUse"],
          blocking,
        },
        {
          id: "grok-desk-stop",
          events: ["Stop"],
          blocking: false,
        },
      ],
    },
  };
}

export function parseHookEventName(raw: unknown): ClientHookEventName {
  if (raw === "PreToolUse" || raw === "pre_tool_use") return "PreToolUse";
  if (raw === "Stop" || raw === "stop") return "Stop";
  return "unknown";
}

export function parseHookRunParams(params: unknown): ClientHookRunInput {
  const obj =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  const nested =
    obj.hook && typeof obj.hook === "object" && !Array.isArray(obj.hook)
      ? (obj.hook as Record<string, unknown>)
      : obj;
  const toolObj =
    nested.tool && typeof nested.tool === "object" && !Array.isArray(nested.tool)
      ? (nested.tool as Record<string, unknown>)
      : nested;
  const toolInputRaw = nested.toolInput ?? nested.tool_input ?? toolObj.input;
  const toolInput =
    toolInputRaw &&
    typeof toolInputRaw === "object" &&
    !Array.isArray(toolInputRaw)
      ? (toolInputRaw as Record<string, unknown>)
      : {};
  const toolName =
    (typeof nested.toolName === "string" && nested.toolName) ||
    (typeof nested.tool_name === "string" && nested.tool_name) ||
    (typeof toolObj.name === "string" && toolObj.name) ||
    (typeof nested.tool === "string" && nested.tool) ||
    "";
  return {
    hookEventName: parseHookEventName(
      nested.hookEventName ?? nested.hook_event_name ?? nested.event,
    ),
    toolName,
    toolInput,
  };
}

export function hookToolToRequest(input: ClientHookRunInput): ToolRequest {
  const n = input.toolName.toLowerCase();
  const path =
    typeof input.toolInput.path === "string"
      ? input.toolInput.path
      : typeof input.toolInput.file_path === "string"
        ? input.toolInput.file_path
        : undefined;
  const command =
    typeof input.toolInput.command === "string"
      ? input.toolInput.command
      : undefined;
  let tool: ToolName = "other";
  if (
    /\bbash\b|\bshell\b|\bterminal\b|\brun_terminal/.test(n) ||
    n === "exec"
  ) {
    tool = "shell";
  } else if (/\bdelete\b|\bunlink\b/.test(n)) {
    tool = "delete_file";
  } else if (/\bwrite\b|\bedit\b|\bsearch_replace\b/.test(n)) {
    tool = "write_file";
  } else if (/\bread\b/.test(n)) {
    tool = "read_file";
  } else if (/\bnetwork\b|\bfetch\b|\bhttp\b/.test(n)) {
    tool = "network";
  } else if (/\bbrowser\b/.test(n)) {
    tool = "browser_open";
  }
  return { tool, path, command, meta: { hookToolName: input.toolName } };
}

/**
 * Desk policy as a PreToolUse verdict. Only deny blocks.
 * needs_approval fails open here — session/request_permission still asks.
 */
export function decideClientHook(
  input: ClientHookRunInput,
  policy: PolicySnapshot,
): ClientHookDecision {
  if (input.hookEventName !== "PreToolUse") {
    return { decision: "allow" };
  }
  const req = hookToolToRequest(input);
  const result = evaluateToolRequest(policy, req);
  if (result.decision === "deny") {
    return { decision: "deny", reason: result.reason };
  }
  return { decision: "allow" };
}

/**
 * Map a hook RPC result to allow/deny. Unknown / missing / malformed → allow.
 */
export function interpretHookRunResult(result: unknown): ClientHookDecision {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { decision: "allow" };
  }
  const obj = result as Record<string, unknown>;
  const nested =
    obj.hookSpecificOutput &&
    typeof obj.hookSpecificOutput === "object" &&
    !Array.isArray(obj.hookSpecificOutput)
      ? (obj.hookSpecificOutput as Record<string, unknown>)
      : obj;
  const decision = nested.decision ?? nested.permissionDecision;
  if (decision !== "deny") {
    const updated =
      nested.updatedInput &&
      typeof nested.updatedInput === "object" &&
      !Array.isArray(nested.updatedInput)
        ? (nested.updatedInput as Record<string, unknown>)
        : undefined;
    return updated
      ? { decision: "allow", updatedInput: updated }
      : { decision: "allow" };
  }
  const reason =
    (typeof nested.reason === "string" && nested.reason) ||
    (typeof nested.permissionDecisionReason === "string" &&
      nested.permissionDecisionReason) ||
    "Denied by client hook";
  return { decision: "deny", reason };
}

/** ACP result for x.ai/hooks/run. Only explicit deny sets continue:false. */
export function formatHookRunResult(
  decision: ClientHookDecision,
  hookEventName: ClientHookEventName = "PreToolUse",
): Record<string, unknown> {
  if (decision.decision === "deny") {
    return {
      continue: false,
      decision: "deny",
      reason: decision.reason,
      hookSpecificOutput: {
        hookEventName,
        permissionDecision: "deny",
        permissionDecisionReason: decision.reason,
      },
    };
  }
  return {
    continue: true,
    decision: "allow",
    ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "allow",
      ...(decision.updatedInput
        ? { updatedInput: decision.updatedInput }
        : {}),
    },
  };
}
