/**
 * Build memory takeaways text from task goal + recent assistant messages.
 */

export interface TakeawayEvent {
  kind: string;
  payload: Record<string, unknown>;
}

/**
 * Prefer the last substantial assistant text channel; fall back to goal.
 */
export function buildTakeawaysContent(opts: {
  taskId: string;
  goal: string;
  events: TakeawayEvent[];
  maxChars?: number;
}): string {
  const max = opts.maxChars ?? 2000;
  const assistantTexts: string[] = [];
  for (const ev of opts.events) {
    if (ev.kind !== "message") continue;
    const role = String(ev.payload.role ?? "");
    const channel = String(ev.payload.channel ?? "text");
    if (role !== "assistant") continue;
    if (channel === "thought") continue;
    const text = String(ev.payload.text ?? ev.payload.content ?? "").trim();
    if (text.length >= 40) assistantTexts.push(text);
  }
  const last = assistantTexts[assistantTexts.length - 1];
  const body = last
    ? last.slice(0, max)
    : `Goal: ${opts.goal}`.slice(0, max);
  return [
    `From task ${opts.taskId}`,
    `Goal: ${opts.goal}`,
    "",
    last ? "Summary / last answer:" : "No assistant answer captured yet.",
    body,
  ].join("\n");
}
