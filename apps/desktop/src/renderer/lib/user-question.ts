/**
 * Heuristic extraction of "Grok is asking the user to choose" from assistant prose.
 * Used to render selectable chips until the engine emits structured user_question events.
 */

export type UserQuestionOption = {
  id: string;
  label: string;
};

export type ExtractedUserQuestion = {
  prompt: string;
  options: UserQuestionOption[];
  /** True when the turn ends with a question even if options were sparse. */
  isQuestion: boolean;
};

const MIN_OPTION_LEN = 2;
const MAX_OPTION_LEN = 120;
const MAX_OPTIONS = 8;

/**
 * Extract a multi-choice (or open) question from assistant text.
 * Returns null when the message does not look like a user-facing question.
 */
export function extractUserQuestion(
  text: string,
): ExtractedUserQuestion | null {
  const raw = text?.trim() ?? "";
  if (raw.length < 12) return null;

  const options = extractOptions(raw);
  const endsWithQuestion = /\?\s*$/.test(raw) || /\?\s*\n/.test(raw);
  const hasQuestionCue =
    endsWithQuestion ||
    /\b(which|what|how would you|do you want|prefer|choose|pick|select|should i|shall i|want me to)\b/i.test(
      raw,
    );

  if (!hasQuestionCue && options.length < 2) return null;
  if (options.length < 2 && !endsWithQuestion) return null;

  // Prompt: prefer last non-empty line that ends with ?, else last paragraph.
  const prompt = extractPrompt(raw, options);

  if (options.length >= 2) {
    return {
      prompt,
      options: options.slice(0, MAX_OPTIONS),
      isQuestion: true,
    };
  }

  // Open question with free-text only — still surface a soft "Reply below" card.
  if (endsWithQuestion) {
    return {
      prompt,
      options: [],
      isQuestion: true,
    };
  }

  return null;
}

function extractPrompt(raw: string, options: UserQuestionOption[]): string {
  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.endsWith("?") && !isOptionLine(line)) {
      return line.length > 280 ? `${line.slice(0, 279).trimEnd()}…` : line;
    }
  }
  // Drop option lines from the tail for a short prompt blurb.
  const optionLabels = new Set(options.map((o) => o.label.toLowerCase()));
  const prose = lines
    .filter((l) => !isOptionLine(l) && !optionLabels.has(stripOptionPrefix(l).toLowerCase()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (prose.length > 0) {
    return prose.length > 280 ? `${prose.slice(0, 279).trimEnd()}…` : prose;
  }
  return raw.length > 280 ? `${raw.slice(0, 279).trimEnd()}…` : raw;
}

function isOptionLine(line: string): boolean {
  return (
    /^([-*•]|\d{1,2}[.)]|[A-Za-z][.)])\s+\S/.test(line.trim()) ||
    /^\d{1,2}\s*[-–—:]\s+\S/.test(line.trim())
  );
}

function stripOptionPrefix(line: string): string {
  return line
    .replace(/^([-*•]|\d{1,2}[.)]|[A-Za-z][.)])\s+/, "")
    .replace(/^\d{1,2}\s*[-–—:]\s+/, "")
    .trim();
}

function extractOptions(raw: string): UserQuestionOption[] {
  const lines = raw.split(/\n/);
  const found: UserQuestionOption[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !isOptionLine(trimmed)) continue;
    const label = stripOptionPrefix(trimmed);
    if (label.length < MIN_OPTION_LEN || label.length > MAX_OPTION_LEN) continue;
    // Skip pure punctuation / markdown fences
    if (/^[`*_#|>]/.test(label)) continue;
    if (label.endsWith(":") && label.length < 20) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      id: `opt-${found.length + 1}`,
      label,
    });
    if (found.length >= MAX_OPTIONS) break;
  }

  // Inline "A or B" / "yes/no" patterns when no list found
  if (found.length < 2) {
    const yn = raw.match(/\b(yes)\s*\/\s*(no)\b/i);
    if (yn) {
      return [
        { id: "opt-1", label: "Yes" },
        { id: "opt-2", label: "No" },
      ];
    }
    const orPair = raw.match(
      /(?:^|[.?!]\s+)(?:Would you (?:like|prefer)|Do you want|Should I)\s+(.+?)\s+or\s+(.+?)\?\s*$/is,
    );
    if (orPair) {
      const a = cleanInlineOption(orPair[1]!);
      const b = cleanInlineOption(orPair[2]!);
      if (a && b && a.length <= MAX_OPTION_LEN && b.length <= MAX_OPTION_LEN) {
        return [
          { id: "opt-1", label: a },
          { id: "opt-2", label: b },
        ];
      }
    }
  }

  return found;
}

function cleanInlineOption(s: string): string {
  return s
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[?.!,;]+$/g, "")
    .trim();
}

/**
 * Given ordered stream items (assistant/user/...), find the latest unanswered
 * question: last assistant with extractable question and no later user message.
 */
export function findUnansweredQuestion(
  blocks: Array<{ kind: string; id: string; text?: string }>,
): { assistantId: string; question: ExtractedUserQuestion } | null {
  let lastAssistant: { id: string; text: string } | null = null;
  let lastUserAfterAssistant = false;

  for (const b of blocks) {
    if (b.kind === "assistant" && typeof b.text === "string") {
      lastAssistant = { id: b.id, text: b.text };
      lastUserAfterAssistant = false;
    } else if (b.kind === "user") {
      if (lastAssistant) lastUserAfterAssistant = true;
    }
  }

  if (!lastAssistant || lastUserAfterAssistant) return null;
  const question = extractUserQuestion(lastAssistant.text);
  if (!question || !question.isQuestion) return null;
  // Prefer multi-choice; open questions still return with empty options.
  return { assistantId: lastAssistant.id, question };
}

const TERMINAL_STATUSES = new Set(["done", "failed", "cancelled"]);

/**
 * When a terminal turn ends on a multi-choice question, return chip options
 * for the UI. Open-ended questions (no options) return null — the composer
 * is enough.
 */
export function questionChipsForTerminalTurn(
  blocks: Array<{ kind: string; id: string; text?: string }>,
  taskStatus: string,
): { assistantId: string; options: UserQuestionOption[]; prompt: string } | null {
  if (!TERMINAL_STATUSES.has(taskStatus)) return null;
  const found = findUnansweredQuestion(blocks);
  if (!found || found.question.options.length < 2) return null;
  return {
    assistantId: found.assistantId,
    options: found.question.options,
    prompt: found.question.prompt,
  };
}
