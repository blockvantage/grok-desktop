import { describe, expect, it } from "vitest";
import type { PolicySnapshot } from "./types.js";
import {
  agentAdvertisesBlockingHookEvents,
  agentAdvertisesClientHooks,
  decideClientHook,
  formatHookRunResult,
  interpretHookRunResult,
  parseHookRunParams,
  sessionNewClientHooksMeta,
} from "./client-hooks.js";

const policy: PolicySnapshot = {
  approvalMode: "balanced",
  workspaceRoots: ["/ws"],
  allowShell: false,
  allowNetworkTools: true,
};

describe("client hooks", () => {
  it("registers session/new groups only when initialize advertised hooks", () => {
    expect(agentAdvertisesClientHooks(null)).toBe(false);
    expect(sessionNewClientHooksMeta(null)).toBeNull();
    const meta = { "x.ai/hooks": { blockingEvents: true, decisions: true } };
    expect(agentAdvertisesClientHooks(meta)).toBe(true);
    expect(agentAdvertisesBlockingHookEvents(meta)).toBe(true);
    const registered = sessionNewClientHooksMeta(meta);
    expect(registered?.["x.ai/hooks"]).toMatchObject({
      groups: [
        expect.objectContaining({ events: ["PreToolUse"], blocking: true }),
        expect.objectContaining({ events: ["Stop"], blocking: false }),
      ],
    });
  });

  it("PreToolUse deny is the only blocking verdict; Stop fails open", () => {
    const deny = decideClientHook(
      {
        hookEventName: "PreToolUse",
        toolName: "Bash",
        toolInput: { command: "rm -rf /" },
      },
      policy,
    );
    expect(deny).toEqual({
      decision: "deny",
      reason: "Shell is disabled by policy",
    });
    expect(
      decideClientHook(
        { hookEventName: "Stop", toolName: "", toolInput: {} },
        policy,
      ).decision,
    ).toBe("allow");
    expect(
      decideClientHook(
        {
          hookEventName: "PreToolUse",
          toolName: "Read",
          toolInput: { path: "/ws/a.ts" },
        },
        policy,
      ).decision,
    ).toBe("allow");
  });

  it("unknown / malformed hook results fail open", () => {
    expect(interpretHookRunResult(null).decision).toBe("allow");
    expect(interpretHookRunResult({ decision: "ask" }).decision).toBe("allow");
    expect(interpretHookRunResult({ decision: "allow_once" }).decision).toBe(
      "allow",
    );
    expect(interpretHookRunResult({ decision: "deny", reason: "nope" })).toEqual(
      { decision: "deny", reason: "nope" },
    );
    expect(
      interpretHookRunResult({
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: "blocked",
        },
      }),
    ).toEqual({ decision: "deny", reason: "blocked" });
  });

  it("needs_approval PreToolUse fails open so permission RPC can still ask", () => {
    const ask = decideClientHook(
      {
        hookEventName: "PreToolUse",
        toolName: "Bash",
        toolInput: { command: "curl http://example.test" },
      },
      { ...policy, allowShell: true, approvalMode: "balanced" },
    );
    expect(ask.decision).toBe("allow");
  });

  it("formats deny as the only blocking hook result", () => {
    expect(
      formatHookRunResult({ decision: "deny", reason: "nope" }, "PreToolUse"),
    ).toMatchObject({
      continue: false,
      decision: "deny",
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect(formatHookRunResult({ decision: "allow" }, "Stop")).toMatchObject({
      continue: true,
      decision: "allow",
      hookSpecificOutput: { permissionDecision: "allow" },
    });
  });

  it("parses several ACP hook envelope shapes", () => {
    expect(
      parseHookRunParams({
        hookEventName: "PreToolUse",
        toolName: "Bash",
        toolInput: { command: "ls" },
      }),
    ).toMatchObject({
      hookEventName: "PreToolUse",
      toolName: "Bash",
    });
    expect(
      parseHookRunParams({
        hook_event_name: "pre_tool_use",
        tool_name: "Write",
        tool_input: { file_path: "/ws/a" },
      }).hookEventName,
    ).toBe("PreToolUse");
  });
});
