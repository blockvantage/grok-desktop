/**
 * Collapse and present task events as a readable agent stream
 * (not one raw-JSON card per token).
 */

import { t } from "@/i18n/active";
import { projectApprovalCard } from "@grokdesk/shared";

export type StreamBlock =
  | {
      id: string;
      kind: "assistant";
      text: string;
      seq: number;
    }
  | {
      id: string;
      kind: "thought";
      text: string;
      seq: number;
    }
  | {
      id: string;
      kind: "user";
      text: string;
      seq: number;
    }
  | {
      id: string;
      kind: "step";
      title: string;
      status: "start" | "end" | string;
      seq: number;
    }
  | {
      id: string;
      kind: "status";
      status: string;
      seq: number;
    }
  | {
      id: string;
      kind: "tool";
      tool: string;
      detail: string;
      phase: "request" | "result";
      ok?: boolean;
      seq: number;
    }
  | {
      id: string;
      kind: "approval";
      reason: string;
      /** Tool/command/path line for the decision surface (CH-2). */
      detail?: string;
      /** I4: what · where · why (from shared projector). */
      what?: string;
      where?: string;
      why?: string;
      scope?: "once" | "always" | "session" | null;
      effectClass?: string;
      seq: number;
    }
  | {
      id: string;
      kind: "artifact";
      title: string;
      path?: string;
      seq: number;
    }
  | {
      id: string;
      kind: "error";
      message: string;
      seq: number;
    }
  | {
      id: string;
      kind: "meta";
      label: string;
      /** Functional tone for resolved approvals etc. */
      tone?: "success" | "danger" | "muted";
      seq: number;
    };

export interface RawTaskEventLike {
  id: string;
  seq: number;
  kind: string;
  payload: Record<string, unknown>;
}

/** Types that must never appear as assistant prose. */
const NOISE_STREAM_TYPES = new Set([
  "end",
  "max_turns_reached",
  "auto_compact",
  "auto_compact_start",
  "auto_compact_end",
  "ping",
  "status",
  "heartbeat",
]);

/**
 * Unwrap legacy rows that stored the raw streaming-json envelope as `text`:
 *   {"role":"assistant","text":"{\"type\":\"thought\",\"data\":\"The\"}"}
 * Also strips end/metadata envelopes that leaked into older builds.
 */
export function unwrapMessagePayload(payload: Record<string, unknown>): {
  role: "assistant" | "user";
  channel: "text" | "thought";
  text: string;
  drop: boolean;
} {
  let role: "assistant" | "user" =
    payload.role === "user" ? "user" : "assistant";
  let channel: "text" | "thought" =
    payload.channel === "thought" ? "thought" : "text";
  let text = String(payload.text ?? "");
  let drop = false;

  const applyEnvelope = (inner: Record<string, unknown>): boolean => {
    const typ = String(inner.type ?? "").toLowerCase();
    if (!typ) return false;
    if (NOISE_STREAM_TYPES.has(typ) || typ.startsWith("auto_compact")) {
      drop = true;
      text = "";
      return true;
    }
    if (typ === "thought" || typ === "text") {
      channel = typ === "thought" ? "thought" : "text";
      text = String(inner.data ?? inner.text ?? "");
      return true;
    }
    if (typ === "error") {
      // surface as text so caller can route; keep message
      text = String(inner.message ?? inner.error ?? inner.data ?? "");
      channel = "text";
      return true;
    }
    // Unknown typed envelope → drop rather than dump JSON
    if (typ && (inner.data !== undefined || inner.sessionId || inner.requestId)) {
      drop = true;
      text = "";
      return true;
    }
    return false;
  };

  // Nested JSON string from the broken parser
  const tryParse = (raw: string): boolean => {
    const t = raw.trim();
    if (!t.startsWith("{") || !t.includes("type")) return false;
    try {
      const inner = JSON.parse(t) as Record<string, unknown>;
      return applyEnvelope(inner);
    } catch {
      return false;
    }
  };

  if (typeof payload.type === "string") {
    applyEnvelope(payload);
  } else if (tryParse(text)) {
    // unwrapped
  }

  // Final safety: if still looks like a stream envelope, drop it
  if (!drop && text.trim().startsWith("{") && /"type"\s*:/.test(text)) {
    try {
      const inner = JSON.parse(text.trim()) as Record<string, unknown>;
      if (typeof inner.type === "string") {
        applyEnvelope(inner);
      }
    } catch {
      // keep as prose
    }
  }

  // Lifecycle noise from our own engine wrapper / session bootstrap / heartbeats.
  // These used to land as full assistant bubbles and make kickoff look duplicated.
  if (
    /^(Grok Build completed|Grok Build finished|Completed|EndTurn)/i.test(
      text.trim(),
    ) ||
    /^(Starting Grok[….]|Session ready[—–-]|Grok CLI\b.*probing)/i.test(
      text.trim(),
    ) ||
    /^Still working on tools in the background/i.test(text.trim())
  ) {
    drop = true;
    text = "";
  }

  return { role, channel, text, drop };
}

/**
 * Collapse consecutive token/message events into readable stream blocks.
 */
export function collapseEventsToBlocks(
  events: RawTaskEventLike[],
): StreamBlock[] {
  const blocks: StreamBlock[] = [];

  const pushOrMergeText = (
    kind: "assistant" | "thought" | "user",
    text: string,
    ev: RawTaskEventLike,
  ) => {
    if (!text) return;
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind) {
      // Streamed tokens must merge. Complete utterances (status lines the
      // model emits as separate messages) should stay separate so chat UI
      // can fold them into a progress trail instead of one mega-bubble.
      const shouldMerge =
        kind !== "assistant" ||
        !looksLikeCompleteUtterance(last.text) ||
        !looksLikeNewUtterance(text);
      if (shouldMerge) {
        last.text += text;
        return;
      }
    }
    blocks.push({
      id: `${kind}-${ev.id}`,
      kind,
      text,
      seq: ev.seq,
    });
  };

  for (const ev of events) {
    const p = ev.payload ?? {};

    if (ev.kind === "message") {
      const { role, channel, text, drop } = unwrapMessagePayload(p);
      if (drop || !text) continue;
      if (role === "user") {
        pushOrMergeText("user", text, ev);
      } else if (channel === "thought") {
        pushOrMergeText("thought", text, ev);
      } else {
        pushOrMergeText("assistant", text, ev);
      }
      continue;
    }

    if (ev.kind === "step") {
      let title = String(p.title ?? "Step");
      // Humanize our own wrapper step
      if (/^Grok Build session$/i.test(title)) title = "Session";
      // Heartbeat / isolation noise — never show as stream steps
      if (
        /^Still working on tools/i.test(title) ||
        /^Starting Grok/i.test(title) ||
        /^Session ready/i.test(title) ||
        /^Grok CLI\b/i.test(title) ||
        /^Isolated Grok profile/i.test(title) ||
        /^Inherited user Grok/i.test(title)
      ) {
        continue;
      }
      const status = String(p.status ?? "start");
      const last = blocks[blocks.length - 1];
      if (
        last?.kind === "step" &&
        last.title === title &&
        last.status === "start" &&
        (status === "end" || status === "completed" || status === "done")
      ) {
        last.status = "end";
        continue;
      }
      // Drop lone end without start if we already have content
      if (
        (status === "end" || status === "completed") &&
        last?.kind === "step" &&
        last.title === title
      ) {
        last.status = "end";
        continue;
      }
      blocks.push({
        id: `step-${ev.id}`,
        kind: "step",
        title,
        status,
        seq: ev.seq,
      });
      continue;
    }

    if (ev.kind === "status_change") {
      const status = String(p.status ?? "");
      // Only terminal / waiting statuses
      if (
        status === "queued" ||
        status === "running" ||
        status === "done" // shown via badge in header already; keep subtle
      ) {
        if (status === "done") {
          // Only if we don't already have a terminal marker
          const hasTerminal = blocks.some(
            (b) => b.kind === "status" && b.status === "done",
          );
          if (!hasTerminal) {
            blocks.push({
              id: `status-${ev.id}`,
              kind: "status",
              status,
              seq: ev.seq,
            });
          }
        }
        continue;
      }
      blocks.push({
        id: `status-${ev.id}`,
        kind: "status",
        status,
        seq: ev.seq,
      });
      continue;
    }

    if (ev.kind === "tool_request") {
      const tool = humanToolName(String(p.tool ?? p.name ?? "tool"));
      const detail = String(
        p.path ?? p.command ?? (p.meta ? summarizeMeta(p.meta) : ""),
      );
      blocks.push({
        id: `tool-req-${ev.id}`,
        kind: "tool",
        tool,
        detail,
        phase: "request",
        seq: ev.seq,
      });
      continue;
    }

    if (ev.kind === "tool_result") {
      const ok = p.ok !== false;
      const output = String(p.output ?? "");
      blocks.push({
        id: `tool-res-${ev.id}`,
        kind: "tool",
        tool: t("stream.toolResult"),
        detail: truncate(output, 500),
        phase: "result",
        ok,
        seq: ev.seq,
      });
      continue;
    }

    if (ev.kind === "approval_required") {
      // I4: shared projector owns what/where/why; keep detail for older UI.
      const card = projectApprovalCard(p);
      const detailParts = [card.what, card.where].filter(Boolean);
      blocks.push({
        id: `appr-${ev.id}`,
        kind: "approval",
        reason: card.why || String(p.reason ?? t("stream.approvalRequired")),
        detail: detailParts.length ? detailParts.join(" · ") : undefined,
        what: card.what,
        where: card.where || undefined,
        why: card.why,
        scope: card.scope,
        effectClass: card.effectClass,
        seq: ev.seq,
      });
      continue;
    }

    if (ev.kind === "approval_resolved") {
      const decision = String(p.decision ?? "resolved");
      const approved =
        decision === "approve" || decision === "approved";
      const rejected =
        decision === "reject" || decision === "rejected";
      blocks.push({
        id: `appr-res-${ev.id}`,
        kind: "meta",
        label: approved
          ? t("stream.approved")
          : rejected
            ? t("stream.rejected")
            : `${t("stream.approvalRequired")} ${decision}`,
        tone: approved ? "success" : rejected ? "danger" : "muted",
        seq: ev.seq,
      });
      continue;
    }

    if (ev.kind === "artifact_created") {
      blocks.push({
        id: `art-${ev.id}`,
        kind: "artifact",
        title: String(p.title ?? t("stream.artifact")),
        path: typeof p.path === "string" ? p.path : undefined,
        seq: ev.seq,
      });
      continue;
    }

    if (ev.kind === "error") {
      blocks.push({
        id: `err-${ev.id}`,
        kind: "error",
        message: String(p.message ?? t("common.error")),
        seq: ev.seq,
      });
      continue;
    }
  }

  // Drop session step bookends if the only other content is thoughts+status
  // (they add noise without value for simple chat-style runs)
  const meaningful = blocks.filter(
    (b) =>
      b.kind === "assistant" ||
      b.kind === "thought" ||
      b.kind === "tool" ||
      b.kind === "error" ||
      b.kind === "artifact" ||
      b.kind === "approval",
  );
  if (meaningful.length > 0) {
    return blocks.filter((b) => {
      if (b.kind === "step" && b.title === "Session") return false;
      return true;
    });
  }

  return blocks;
}

function humanToolName(raw: string): string {
  const map: Record<string, string> = {
    read_file: t("stream.readFile"),
    write_file: t("stream.writeFile"),
    delete_file: t("stream.deleteFile"),
    shell: t("stream.shell"),
    network: t("stream.network"),
    other: t("stream.tool"),
    browser_open: t("stream.browserOpen"),
    browser_click: t("stream.browserClick"),
    browser_type: t("stream.browserType"),
    browser_scroll: t("stream.browserScroll"),
    browser_screenshot: t("stream.browserScreenshot"),
    browser_read: t("stream.browserRead"),
  };
  return map[raw] ?? raw.replace(/_/g, " ");
}

function summarizeMeta(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const m = meta as Record<string, unknown>;
  if (typeof m.path === "string") return m.path;
  if (typeof m.command === "string") return m.command;
  if (typeof m.file_path === "string") return m.file_path;
  try {
    return truncate(JSON.stringify(m), 120);
  } catch {
    return "";
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

/** Prior assistant text looks finished (not a mid-token fragment). */
function looksLikeCompleteUtterance(text: string): boolean {
  const t = text.trimEnd();
  if (t.length < 24) return false;
  return /[.!?…)]$/.test(t) || /\n\n\S/.test(t);
}

/** Incoming chunk looks like a new sentence/message, not the next token. */
function looksLikeNewUtterance(text: string): boolean {
  const t = text.trimStart();
  if (!t) return false;
  // Token streams often start with a leading space + lowercase continuation.
  if (/^[a-z,;:]/.test(t)) return false;
  if (/^\s+[a-z]/.test(text)) return false;
  return (
    t.length >= 12 &&
    (/^[A-Z#*\-`\d]/.test(t) || t.startsWith("I'll") || t.startsWith("I "))
  );
}

/** One line in a collapsed thinking / progress trail. */
export type ChatProgressLine = {
  id: string;
  text: string;
  seq: number;
};

/** Synthetic chat block: intermediate thoughts + status assistant turns. */
export type ChatProgressBlock = {
  kind: "progress";
  id: string;
  lines: ChatProgressLine[];
  /** True while the task is still working and no final answer has landed yet. */
  live: boolean;
  seq: number;
};

export type ChatStreamItem = StreamBlock | ChatProgressBlock;

/**
 * Short status / plan updates that should not each become a full Grok bubble.
 *
 * Keep this tight: previously anything ≤320 chars was treated as "progress",
 * so live runs with real status prose vanished into a collapsed Thinking row
 * while tools executed silently (Grok Build rarely emits tool_use in stream).
 */
export function looksLikeProgressText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // Only very short pings are pure progress. Longer status is shown as a bubble
  // so the user can see what Grok is doing mid-run.
  if (t.length <= 100) return true;
  if (
    t.length <= 220 &&
    /^(I(?:'ll| will)|Next I(?:'ll| will)|Let me|Looking|Analyzing|Checking|Searching|Reading|Mapping|Planning|Working on|Continuing|Running|Opening|Waiting|Still)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** Structured / long replies that should stay as full assistant turns. */
export function looksLikeFinalAnswer(text: string): boolean {
  const t = text.trim();
  if (t.length >= 480) return true;
  if (/^#{1,3}\s/m.test(t)) return true;
  if (/\n\|.+\|/.test(t)) return true;
  if (/\n[-*]\s+\S/.test(t) && t.length > 200) return true;
  if (/\n\n/.test(t) && t.length > 280) return true;
  return false;
}

export type PrepareChatStreamOptions = {
  /**
   * When true (task running/queued), short status lines may stay in the
   * progress trail. When false (done/failed/…), the last assistant block is
   * always treated as the answer so short finals are not buried in Thinking.
   */
  active?: boolean;
  /** Optional task status; "done" forces last assistant as answer. */
  taskStatus?: string;
};

/**
 * Fold thoughts + intermediate assistant status updates into a single
 * progress trail for chat density. The final (or only substantial) answer
 * stays a normal assistant block.
 *
 * @param activeOrOpts - boolean for back-compat, or options with taskStatus
 */
export function prepareChatStream(
  blocks: StreamBlock[],
  activeOrOpts: boolean | PrepareChatStreamOptions = false,
): ChatStreamItem[] {
  const opts: PrepareChatStreamOptions =
    typeof activeOrOpts === "boolean"
      ? { active: activeOrOpts }
      : activeOrOpts ?? {};
  const taskDone =
    opts.taskStatus === "done" ||
    opts.taskStatus === "failed" ||
    opts.taskStatus === "cancelled";
  // Done tasks are never "active" for folding purposes.
  const active = taskDone ? false : Boolean(opts.active);

  const out: ChatStreamItem[] = [];
  let i = 0;

  while (i < blocks.length) {
    const head = blocks[i]!;
    if (head.kind === "user") {
      out.push(head);
      i += 1;
      continue;
    }

    // Segment until the next user message (one agent "turn").
    const segment: StreamBlock[] = [];
    while (i < blocks.length && blocks[i]!.kind !== "user") {
      segment.push(blocks[i]!);
      i += 1;
    }

    const assistants = segment.filter(
      (b): b is Extract<StreamBlock, { kind: "assistant" }> =>
        b.kind === "assistant",
    );
    const thoughts = segment.filter(
      (b): b is Extract<StreamBlock, { kind: "thought" }> =>
        b.kind === "thought",
    );

    const progressAssistantIds = new Set<string>();
    let answerId: string | null = null;

    if (assistants.length === 0) {
      // thoughts only (or tools/etc.)
    } else if (assistants.length === 1) {
      const a = assistants[0]!;
      // When the task is finished, a sole short line is still the answer.
      if (
        active &&
        looksLikeProgressText(a.text) &&
        !looksLikeFinalAnswer(a.text)
      ) {
        progressAssistantIds.add(a.id);
      } else {
        answerId = a.id;
      }
    } else {
      for (const a of assistants.slice(0, -1)) {
        progressAssistantIds.add(a.id);
      }
      const last = assistants[assistants.length - 1]!;
      // Done: last assistant is always the answer (even if short).
      if (
        active &&
        looksLikeProgressText(last.text) &&
        !looksLikeFinalAnswer(last.text)
      ) {
        // Still only status lines — entire set is progress until a real answer.
        progressAssistantIds.add(last.id);
      } else {
        answerId = last.id;
      }
    }

    const progressLines: ChatProgressLine[] = [];
    for (const t of thoughts) {
      progressLines.push({ id: t.id, text: t.text.trim(), seq: t.seq });
    }
    for (const a of assistants) {
      if (progressAssistantIds.has(a.id)) {
        progressLines.push({ id: a.id, text: a.text.trim(), seq: a.seq });
      }
    }
    progressLines.sort((a, b) => a.seq - b.seq);

    let progressEmitted = false;
    const emitProgress = (live: boolean) => {
      if (progressEmitted || progressLines.length === 0) return;
      progressEmitted = true;
      out.push({
        kind: "progress",
        id: `progress-${progressLines[0]!.id}`,
        lines: progressLines,
        live,
        seq: progressLines[0]!.seq,
      });
    };

    for (const s of segment) {
      if (s.kind === "thought") {
        emitProgress(active && !answerId);
        continue;
      }
      if (s.kind === "assistant") {
        if (progressAssistantIds.has(s.id)) {
          emitProgress(active && !answerId);
          continue;
        }
        // Final (or sole) answer — progress trail sits above it.
        emitProgress(false);
        out.push(s);
        continue;
      }
      out.push(s);
    }

    // Thoughts / status only so far (still working or finished without prose).
    emitProgress(active && !answerId);
  }

  return out;
}

/**
 * Human-readable result summary for the task header.
 * Prefers real assistant prose; never surfaces "Grok Build completed" or event counts.
 */
export function extractResultSummary(
  events: RawTaskEventLike[],
  opts?: {
    status?: string;
    deliverableNames?: string[];
  },
): string {
  const names = opts?.deliverableNames?.filter(Boolean) ?? [];
  if (names.length === 1) {
    return t("stream.createdOne", { name: names[0]! });
  }
  if (names.length > 1) {
    const head = names.slice(0, 2).join(", ");
    const extra = names.length - 2;
    // The " · " separator lives here, not in the locale value: moreFiles /
    // moreFilesOne also render standalone in the deliverables digest chip.
    const more =
      extra > 0
        ? ` · ${t(extra === 1 ? "stream.moreFilesOne" : "stream.moreFiles", {
            n: extra,
          })}`
        : "";
    return t("stream.createdMany", { head, more });
  }

  // Prefer assistant text channel (not thinking tokens)
  const assistantParts: string[] = [];
  for (const ev of events) {
    if (ev.kind !== "message") continue;
    const { role, channel, text, drop } = unwrapMessagePayload(ev.payload ?? {});
    if (drop || !text || role === "user" || channel === "thought") continue;
    assistantParts.push(text);
  }
  const joined = assistantParts.join("").trim();
  if (joined.length >= 24) {
    const sentence = joined.match(/^[\s\S]{24,180}?[.!?]\s/)?.[0]?.trim();
    return sentence || truncate(joined.replace(/\s+/g, " "), 180);
  }

  if (opts?.status === "done") {
    return t("stream.finished");
  }
  if (opts?.status === "failed") {
    return t("stream.failed");
  }
  if (opts?.status === "running" || opts?.status === "queued") {
    return t("stream.working");
  }
  if (opts?.status === "waiting_approval") {
    return t("stream.waitingApproval");
  }
  return t("stream.openLog");
}
