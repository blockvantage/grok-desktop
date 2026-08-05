/**
 * Deterministic chat journey scenario knobs for FakeAgentProvider / E2E.
 * Specs compose these rather than weakening production policy.
 */

export type ChatScenarioId =
  | "happy_path_create_stream_done"
  | "follow_up_while_live"
  | "switch_chat_background_drain"
  | "reload_no_duplicate"
  | "gateway_crash_restart"
  | "send_now_supported"
  | "send_now_unsupported"
  | "approval_request"
  | "provider_failure_retry"
  | "missing_attachment"
  | "queue_capacity"
  | "home_draft_restore"
  | "refined_chat_trace";

export type ChatScenario = {
  id: ChatScenarioId;
  /** Fake provider behavior hint (consumed by test composition / future knobs). */
  provider: {
    complete: boolean;
    requestApproval?: boolean;
    failOnce?: boolean;
    streamChunks?: string[];
  };
  env?: Record<string, string>;
};

export const CHAT_SCENARIOS: Record<ChatScenarioId, ChatScenario> = {
  happy_path_create_stream_done: {
    id: "happy_path_create_stream_done",
    provider: {
      complete: true,
      streamChunks: ["Working…", "Done."],
    },
  },
  follow_up_while_live: {
    id: "follow_up_while_live",
    provider: { complete: true },
  },
  switch_chat_background_drain: {
    id: "switch_chat_background_drain",
    provider: { complete: true },
  },
  reload_no_duplicate: {
    id: "reload_no_duplicate",
    provider: { complete: true },
  },
  gateway_crash_restart: {
    id: "gateway_crash_restart",
    provider: { complete: true },
    env: { GROKDESK_E2E: "1" },
  },
  send_now_supported: {
    id: "send_now_supported",
    provider: { complete: true },
  },
  send_now_unsupported: {
    id: "send_now_unsupported",
    provider: { complete: true },
  },
  approval_request: {
    id: "approval_request",
    provider: { complete: false, requestApproval: true },
  },
  provider_failure_retry: {
    id: "provider_failure_retry",
    provider: { complete: true, failOnce: true },
  },
  missing_attachment: {
    id: "missing_attachment",
    provider: { complete: true },
  },
  queue_capacity: {
    id: "queue_capacity",
    provider: { complete: true },
  },
  home_draft_restore: {
    id: "home_draft_restore",
    provider: { complete: true },
  },
  refined_chat_trace: {
    id: "refined_chat_trace",
    provider: { complete: true },
  },
};

/**
 * Anonymized shape of a problematic production chat. The fixture intentionally
 * combines provider envelopes, policy decisions, narration, a real answer,
 * citations, and a Markdown link so the boundaries regress together.
 */
export const REFINED_CHAT_TRACE = {
  nestedImageUpdate: JSON.stringify({
    type: "text",
    data: JSON.stringify({
      type: "tool_call_update",
      toolCallId: "image-call",
      status: "completed",
      content: [{ type: "image", data: "A".repeat(8_192) }],
    }),
  }),
  safeInspection: JSON.stringify({
    type: "tool_call",
    id: "inspect-call",
    name: "run_terminal_command",
    input: { command: "git status --short" },
  }),
  destructiveCommand: "rm -rf ./generated-preview",
  narration: "I’ll check the remaining files now.",
  finalAnswer:
    "The review is complete. Open the [security guide](https://www.electronjs.org/docs/latest/tutorial/security) for the source details.",
  citation: {
    url: "https://www.electronjs.org/docs/latest/tutorial/security",
    title: "Electron security guide",
    source: "web" as const,
  },
} as const;

export function scenarioEnv(id: ChatScenarioId): Record<string, string> {
  return { ...(CHAT_SCENARIOS[id].env ?? {}) };
}
