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
  | "home_draft_restore";

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
};

export function scenarioEnv(id: ChatScenarioId): Record<string, string> {
  return { ...(CHAT_SCENARIOS[id].env ?? {}) };
}
