import type { Task } from "@grokdesk/shared";

export type NormalizedEngineEvent =
  | {
      type: "message";
      text: string;
      role: "assistant" | "user";
      /** Grok streaming-json: text = reply tokens, thought = internal reasoning */
      channel?: "text" | "thought";
    }
  | { type: "step"; title: string; status: "start" | "end" }
  | {
      type: "tool_request";
      id: string;
      tool:
        | "read_file"
        | "write_file"
        | "delete_file"
        | "shell"
        | "network"
        | "browser_open"
        | "browser_click"
        | "browser_type"
        | "browser_scroll"
        | "browser_screenshot"
        | "browser_read"
        | "media"
        | "other";
      path?: string;
      command?: string;
      meta?: Record<string, unknown>;
    }
  | { type: "tool_result"; id: string; ok: boolean; output: string }
  | {
      type: "artifact";
      title: string;
      path: string;
      kind: "file" | "report" | "media" | "card";
    }
  | { type: "done"; summary: string }
  | { type: "error"; message: string }
  | {
      type: "plan_update";
      content: string;
      status: "drafting" | "awaiting_approval";
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      contextWindow?: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
    }
  | {
      type: "citations";
      items: Array<{
        url: string;
        title?: string;
        snippet?: string;
        source?: "web" | "x" | "other";
      }>;
    }
  | {
      type: "worker_started";
      workerId: string;
      label?: string;
      objective?: string;
      parentWorkerId?: string;
    }
  | {
      type: "worker_activity";
      workerId: string;
      summary?: string;
      parentWorkerId?: string;
    }
  | {
      type: "worker_message";
      workerId: string;
      text?: string;
      parentWorkerId?: string;
    }
  | {
      type: "worker_completed";
      workerId: string;
      summary?: string;
      parentWorkerId?: string;
    }
  | {
      type: "worker_failed";
      workerId: string;
      summary?: string;
      parentWorkerId?: string;
    }
  /** Transient progress — must not be persisted as assistant transcript. */
  | { type: "run_progress"; message: string }
  | {
      type: "goal_update";
      objective?: string;
      progress?: string;
    }
  | {
      type: "workflow_update";
      payload: Record<string, unknown>;
    }
  | {
      type: "memory_update";
      action: "recalled" | "updated" | "other";
      title?: string;
      content?: string;
    }
  /**
   * Engine session identity for resume + optional spawn protection snapshot (T3).
   * Never user-visible as conversation transcript.
   */
  | {
      type: "session_meta";
      providerSessionId?: string;
      /**
       * Same inputs/args used for this spawn so the protection chip cannot lie.
       * UI re-projects via projectEffectiveProtection({ spawnArgs, … }).
       */
      protection?: {
        spawnArgs: string[];
        supportsSandbox: boolean;
        isolateGrokHome: boolean;
        executesOwnTools: boolean;
      };
      /** ACP `initialize` capability table (Phase 1.1). */
      capabilities?: Record<string, unknown>;
    }
  /** Live SessionStatus snapshot (Phase 1.2). Not transcript. */
  | {
      type: "session_status";
      status: Record<string, unknown>;
    };

export interface EngineRunOptions {
  task: Task;
  systemPreamble: string;
  onEvent: (event: NormalizedEngineEvent) => Promise<"continue" | "abort">;
  /**
   * Isolated agent-browser session key (usually chat root task id).
   * Injected into desk-browser MCP as GROKDESK_BROWSER_TASK_ID.
   */
  browserSessionId?: string;
  /**
   * When true (default), use an isolated GROK_HOME for the run so global
   * hooks/plugins/skills are not inherited. Set false for explicit
   * inherited-user-configuration compatibility mode.
   */
  isolateGrokHome?: boolean;
  /** Prior engine session to resume (headless --resume / ACP session load). */
  priorProviderSessionId?: string;
  /** Start session in plan mode (ACP session/set_mode). */
  planFirst?: boolean;
  /**
   * T5: folders trusted for project-scoped tools (skills install / project MCP).
   * When omitted, project tools fail closed. Ephemeral MCP in isolated GROK_HOME
   * is still allowed.
   */
  trustedFolders?: string[];
}

export interface EngineAdapter {
  /**
   * When true, the engine process executes host tools itself (Grok Build).
   * When false (test engines), the gateway runner may execute allowed tools.
   */
  readonly executesOwnTools: boolean;
  run(options: EngineRunOptions): Promise<void>;
  cancel(taskId: string): Promise<void>;
  /**
   * Mid-run aside (ACP interjection). Returns false when unsupported.
   * clientMutationId is optional durable dedupe key for reload replay.
   */
  interject?(
    taskId: string,
    text: string,
    clientMutationId?: string,
  ): Promise<boolean>;
  /** Compact conversation context. Returns false when unsupported. */
  compact?(taskId: string): Promise<boolean>;
  /** List rewind points. Null when unsupported. */
  rewindPoints?(
    taskId: string,
  ): Promise<Array<{
    id: string;
    label?: string;
    files?: string[];
    hasFileChanges?: boolean;
  }> | null>;
  /** Execute rewind to a point. */
  rewindTo?(taskId: string, pointId: string): Promise<boolean>;
}

export type EngineStatus = "unknown" | "missing" | "ready" | "needs_auth";
