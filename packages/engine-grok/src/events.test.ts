import { describe, it, expect } from "vitest";
import {
  parseStreamingJsonLine,
  parseStreamingJsonOutput,
} from "./events.js";

describe("parseStreamingJsonLine", () => {
  const workerFixtures = [
    {
      canonical: {
        type: "worker_started",
        workerId: "w1",
        label: "Research",
        objective: "Find evidence",
      },
      provider: {
        type: "subagent_started",
        subagent_id: " w1 ",
        label: "Research",
        objective: "Find evidence",
      },
      normalized: {
        type: "worker_started",
        workerId: "w1",
        label: "Research",
        objective: "Find evidence",
      },
    },
    {
      canonical: {
        type: "worker_activity",
        workerId: "w1",
        summary: "Reading sources",
      },
      provider: {
        type: "subagent_activity",
        subagentId: "w1",
        summary: "Reading sources",
      },
      normalized: {
        type: "worker_activity",
        workerId: "w1",
        summary: "Reading sources",
      },
    },
    {
      canonical: {
        type: "worker_message",
        workerId: "w1",
        text: "Found three sources",
      },
      provider: {
        type: "subagent_message",
        worker_id: "w1",
        text: "Found three sources",
      },
      normalized: {
        type: "worker_message",
        workerId: "w1",
        text: "Found three sources",
      },
    },
    {
      canonical: {
        type: "worker_completed",
        workerId: "w1",
        summary: "Research complete",
      },
      provider: {
        type: "subagent_completed",
        workerId: "w1",
        summary: "Research complete",
      },
      normalized: {
        type: "worker_completed",
        workerId: "w1",
        summary: "Research complete",
      },
    },
    {
      canonical: {
        type: "worker_failed",
        workerId: "w2",
        summary: "Connector unavailable",
      },
      provider: {
        type: "subagent_failed",
        subagent_id: "w2",
        summary: "Connector unavailable",
      },
      normalized: {
        type: "worker_failed",
        workerId: "w2",
        summary: "Connector unavailable",
      },
    },
  ] as const;

  it.each(workerFixtures)(
    "normalizes canonical $canonical.type envelopes",
    ({ canonical, normalized }) => {
      expect(parseStreamingJsonLine(JSON.stringify(canonical))).toEqual([
        normalized,
      ]);
    },
  );

  it.each(workerFixtures)(
    "normalizes provider $provider.type envelopes",
    ({ provider, normalized }) => {
      expect(parseStreamingJsonLine(JSON.stringify(provider))).toEqual([
        normalized,
      ]);
    },
  );

  it("preserves an explicitly supplied parent worker ID without undefined fields", () => {
    expect(
      parseStreamingJsonLine(
        JSON.stringify({
          type: "subagent_activity",
          subagent_id: "child-1",
          parent_subagent_id: " parent-1 ",
        }),
      ),
    ).toEqual([
      {
        type: "worker_activity",
        workerId: "child-1",
        parentWorkerId: "parent-1",
      },
    ]);
  });

  it.each([
    { type: "worker_started", label: "Research" },
    { type: "subagent_message", subagent_id: "   ", text: "hello" },
    { type: "worker_failed", workerId: 42, summary: "bad id" },
    { type: "subagent_update", subagent_id: "w1", summary: "unknown" },
  ])("rejects unknown or invalid worker envelopes: $type", (envelope) => {
    expect(parseStreamingJsonLine(JSON.stringify(envelope))).toEqual([]);
  });

  it("does not infer workers from ordinary thought, message, or child task events", () => {
    expect(
      parseStreamingJsonOutput(
        [
          JSON.stringify({
            type: "thought",
            data: "Delegating research",
            subagent_id: "w1",
          }),
          JSON.stringify({
            type: "message",
            text: "Researching",
            workerId: "w1",
          }),
          JSON.stringify({
            type: "child_task_started",
            workerId: "w1",
            label: "Research",
          }),
        ].join("\n"),
      ),
    ).toEqual([
      {
        type: "message",
        role: "assistant",
        text: "Delegating research",
        channel: "thought",
      },
      {
        type: "message",
        role: "assistant",
        text: "Researching",
        channel: "text",
      },
    ]);
  });

  it("parses assistant message JSON", () => {
    const events = parseStreamingJsonLine(
      JSON.stringify({ type: "message", role: "assistant", text: "Hello" }),
    );
    expect(events).toEqual([
      { type: "message", role: "assistant", text: "Hello", channel: "text" },
    ]);
  });

  it("parses plain text as assistant message", () => {
    const events = parseStreamingJsonLine("PONG");
    expect(events[0]).toMatchObject({
      type: "message",
      role: "assistant",
      text: "PONG",
    });
  });

  it("parses Grok Build thought tokens", () => {
    const events = parseStreamingJsonLine(
      JSON.stringify({ type: "thought", data: " The" }),
    );
    expect(events).toEqual([
      {
        type: "message",
        role: "assistant",
        text: " The",
        channel: "thought",
      },
    ]);
  });

  it("parses Grok Build text tokens", () => {
    const events = parseStreamingJsonLine(
      JSON.stringify({ type: "text", data: "hi" }),
    );
    expect(events).toEqual([
      { type: "message", role: "assistant", text: "hi", channel: "text" },
    ]);
  });

  it("does not render a nested tool_call_update image as assistant text", () => {
    const nested = JSON.stringify({
      type: "tool_call_update",
      toolCallId: "image-1",
      status: "completed",
      content: [{ type: "image", data: "A".repeat(32_000) }],
    });

    expect(
      parseStreamingJsonLine(JSON.stringify({ type: "text", data: nested })),
    ).toEqual([]);
  });

  it("dispatches typed protocol envelopes before generic string fields", () => {
    expect(
      parseStreamingJsonLine(
        JSON.stringify({ type: "tool_result", id: "tool-1", content: "secret" }),
      ),
    ).toEqual([
      { type: "tool_result", id: "tool-1", ok: true, output: "secret" },
    ]);
    expect(
      parseStreamingJsonLine(
        JSON.stringify({ type: "error", text: "provider failed" }),
      ),
    ).toEqual([{ type: "error", message: "provider failed" }]);
    expect(
      parseStreamingJsonLine(
        JSON.stringify({ type: "done", text: "actual final" }),
      ),
    ).toEqual([{ type: "done", summary: "actual final" }]);
  });

  it("maps WorkflowUpdated envelopes to workflow_update events", () => {
    expect(
      parseStreamingJsonLine(
        JSON.stringify({
          type: "WorkflowUpdated",
          handle: "deep-research-2",
          objective: "Compare databases",
          agents_used: 1,
          agent_budget: 4,
        }),
      ),
    ).toEqual([
      {
        type: "workflow_update",
        payload: {
          type: "WorkflowUpdated",
          handle: "deep-research-2",
          objective: "Compare databases",
          agents_used: 1,
          agent_budget: 4,
        },
      },
    ]);
  });

  it("maps MonitorEvent envelopes to monitor_event", () => {
    expect(
      parseStreamingJsonLine(
        JSON.stringify({
          type: "MonitorEvent",
          monitorId: "m1",
          description: "CI",
        }),
      ),
    ).toEqual([
      {
        type: "monitor_event",
        payload: {
          type: "MonitorEvent",
          monitorId: "m1",
          description: "CI",
        },
      },
    ]);
  });

  it("maps MemoryRecalled envelopes to memory_update events", () => {
    expect(
      parseStreamingJsonLine(
        JSON.stringify({
          type: "MemoryRecalled",
          content: "Be concise",
        }),
      ),
    ).toEqual([
      {
        type: "memory_update",
        action: "recalled",
        content: "Be concise",
      },
    ]);
  });

  it("maps GoalUpdated envelopes to goal_update events", () => {
    expect(
      parseStreamingJsonLine(
        JSON.stringify({
          type: "goal_update",
          objective: "Ship the brief",
          progress: "Drafting",
        }),
      ),
    ).toEqual([
      {
        type: "goal_update",
        objective: "Ship the brief",
        progress: "Drafting",
      },
    ]);
    expect(
      parseStreamingJsonLine(
        JSON.stringify({
          type: "GoalUpdated",
          objective: "Ship the brief",
          progress: "Drafting",
        }),
      ),
    ).toEqual([
      {
        type: "goal_update",
        objective: "Ship the brief",
        progress: "Drafting",
      },
    ]);
  });

  it("maps auto_compact envelopes to compact progress steps, not assistant text", () => {
    expect(
      parseStreamingJsonLine(
        JSON.stringify({
          type: "auto_compact_completed",
          summary: "Older turns were summarized.",
        }),
      ),
    ).toEqual([
      {
        type: "run_progress",
        message: "compact_completed: Older turns were summarized.",
      },
    ]);
  });

  it("drops protocol envelopes that exceed the nesting inspection limit", () => {
    let nested = JSON.stringify({
      type: "tool_call_update",
      toolCallId: "image-1",
      content: "INLINE_IMAGE_DATA",
    });
    for (let depth = 0; depth < 4; depth += 1) {
      nested = JSON.stringify({ type: "text", data: nested });
    }

    expect(parseStreamingJsonLine(nested)).toEqual([]);
  });

  it("does not render oversized text or binary data URLs", () => {
    expect(
      parseStreamingJsonLine(
        JSON.stringify({ type: "text", data: "x".repeat(96_001) }),
      ),
    ).toEqual([]);
    expect(
      parseStreamingJsonLine(
        JSON.stringify({
          type: "text",
          data: `data:image/png;base64,${"A".repeat(4096)}`,
        }),
      ),
    ).toEqual([]);
  });

  it("ignores end / housekeeping events", () => {
    expect(
      parseStreamingJsonLine(
        JSON.stringify({ type: "end", stopReason: "EndTurn" }),
      ),
    ).toEqual([]);
  });

  it("does not dump unknown objects as messages", () => {
    expect(
      parseStreamingJsonLine(JSON.stringify({ type: "mystery", foo: 1 })),
    ).toEqual([]);
  });

  it("parses tool_use into tool_request", () => {
    const events = parseStreamingJsonLine(
      JSON.stringify({
        type: "tool_use",
        id: "t1",
        name: "Write",
        input: { path: "/tmp/a.md", content: "x" },
      }),
    );
    expect(events[0]?.type).toBe("tool_request");
    if (events[0]?.type === "tool_request") {
      expect(events[0].tool).toBe("write_file");
      expect(events[0].id).toBe("t1");
      expect(events[0].path).toBe("/tmp/a.md");
    }
  });

  it("extracts nested path and command fields before policy evaluation", () => {
    expect(
      parseStreamingJsonLine(
        JSON.stringify({
          type: "tool_call",
          id: "nested-write",
          name: "write_file",
          arguments: { path: "/outside/report.md", content: "x" },
        }),
      )[0],
    ).toMatchObject({
      type: "tool_request",
      tool: "write_file",
      path: "/outside/report.md",
    });
  });

  it.each(["exec", "exec_command", "run_command"])(
    "maps command alias %s to shell",
    (name) => {
      expect(
        parseStreamingJsonLine(
          JSON.stringify({
            type: "tool_call",
            id: name,
            name,
            input: { command: "rm -rf ./build" },
          }),
        )[0],
      ).toMatchObject({
        type: "tool_request",
        tool: "shell",
        command: "rm -rf ./build",
      });
    },
  );

  it("parses use_tool / mcp_call aliases into tool_request", () => {
    const events = parseStreamingJsonLine(
      JSON.stringify({
        type: "use_tool",
        id: "m1",
        name: "shell",
        arguments: { command: "ls" },
      }),
    );
    expect(events[0]).toMatchObject({
      type: "tool_request",
      tool: "shell",
      command: "ls",
    });
  });

  it("maps run_terminal_command to shell", () => {
    const [event] = parseStreamingJsonLine(
      JSON.stringify({
        type: "tool_call",
        name: "run_terminal_command",
        input: { command: "ls -la" },
      }),
    );
    expect(event).toMatchObject({ type: "tool_request", tool: "shell" });
  });

  it("maps browser.open and browser_open to browser_open", () => {
    const events = parseStreamingJsonLine(
      JSON.stringify({
        type: "tool_use",
        id: "b1",
        name: "browser.open",
        input: { url: "https://example.com" },
      }),
    );
    expect(events[0]).toMatchObject({
      type: "tool_request",
      tool: "browser_open",
    });
  });

  it("maps browser.click to browser_click", () => {
    const events = parseStreamingJsonLine(
      JSON.stringify({ type: "tool_use", id: "b2", name: "browser_click" }),
    );
    expect(events[0]).toMatchObject({
      type: "tool_request",
      tool: "browser_click",
    });
  });

  it("parses done/result", () => {
    const events = parseStreamingJsonLine(
      JSON.stringify({ type: "result", result: "All done" }),
    );
    expect(events).toEqual([{ type: "done", summary: "All done" }]);
  });

  it("parses multi-line live-style fixture", () => {
    const fixture = [
      JSON.stringify({ type: "thought", data: "The" }),
      JSON.stringify({ type: "thought", data: " user" }),
      JSON.stringify({ type: "text", data: "hi" }),
      JSON.stringify({ type: "end", stopReason: "EndTurn" }),
    ].join("\n");
    const events = parseStreamingJsonOutput(fixture);
    expect(events.map((e) => e.type)).toEqual(["message", "message", "message"]);
    expect(events.filter((e) => e.type === "message" && e.channel === "thought")).toHaveLength(2);
    expect(events.filter((e) => e.type === "message" && e.channel === "text")).toHaveLength(1);
  });

  it("emits session_meta from end events instead of dropping the session id", () => {
    const evs = parseStreamingJsonLine(
      '{"type":"end","stopReason":"EndTurn","sessionId":"abc123","usage":{"input_tokens":10,"output_tokens":5}}',
    );
    expect(evs).toContainEqual({
      type: "session_meta",
      providerSessionId: "abc123",
    });
  });

  it("emits usage from end events when usage is present", () => {
    const evs = parseStreamingJsonLine(
      JSON.stringify({
        type: "end",
        stopReason: "EndTurn",
        sessionId: "s1",
        usage: { input_tokens: 8000, output_tokens: 2000 },
        modelUsage: { "grok-4.5": { context_window: 256000 } },
      }),
    );
    expect(evs).toContainEqual({
      type: "usage",
      inputTokens: 8000,
      outputTokens: 2000,
      contextWindow: 256000,
    });
  });
});
