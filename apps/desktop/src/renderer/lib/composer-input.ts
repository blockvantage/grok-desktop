/**
 * Composer keyboard + slash helpers.
 * Enter sends (ChatGPT-style); Shift+Enter inserts a newline.
 */

import type { CommandContext, EffortLevel } from "@grokdesk/shared";
import {
  CommandRegistry,
  registerCoreCommands,
} from "@grokdesk/shared";

export type ComposerKeyAction =
  | { type: "send" }
  | { type: "newline" }
  | { type: "ignore" };

/**
 * Decide how a keydown should affect the home/follow-up composer.
 * Callers still handle mention-menu navigation before this.
 */
export function composerKeyAction(
  e: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey"
  > & { isComposing?: boolean },
  opts?: { allowPlainEnterSend?: boolean },
): ComposerKeyAction {
  // CJK IME: confirming composition fires Enter; do not send mid-composition.
  if (e.isComposing) return { type: "ignore" };
  if (e.key !== "Enter") return { type: "ignore" };
  // Cmd/Ctrl+Enter always sends (legacy + explicit).
  if (e.metaKey || e.ctrlKey) return { type: "send" };
  if (e.altKey) return { type: "ignore" };
  // Shift+Enter = newline when plain Enter sends.
  if (e.shiftKey) {
    return opts?.allowPlainEnterSend === false
      ? { type: "ignore" }
      : { type: "newline" };
  }
  if (opts?.allowPlainEnterSend === false) return { type: "ignore" };
  return { type: "send" };
}

export type SlashCommand = {
  id: string;
  /** Command token without leading slash, e.g. "brief" */
  token: string;
  /** i18n key for label */
  labelKey: string;
  /** i18n key for description */
  descKey: string;
  kind: "fill" | "action";
  /**
   * When true, this is a prompt template (not a deterministic action).
   * Matches CommandDescriptor.kind === "template".
   */
  isTemplate?: boolean;
  /** Goal text when kind is fill (may be i18n key resolved by caller) */
  goalKey?: string;
  action?:
    | "pickFolder"
    | "openSchedule"
    | "openTools"
    | "openMemory"
    | "openRecipes"
    | "showBriefing"
    | "exportPack"
    | "compact"
    | "rewind"
    | "remember";
  /** Optional effort escalation when the command is applied (fill only). */
  effort?: EffortLevel;
  /** Registry id for capability gating (e.g. core.image). */
  registryId?: string;
};

/** Shared command registry for capability gating (CMD-01 / Phase 5). */
let _slashRegistry: CommandRegistry | null = null;
export function getSlashCommandRegistry(): CommandRegistry {
  if (!_slashRegistry) {
    _slashRegistry = new CommandRegistry();
    registerCoreCommands(_slashRegistry);
  }
  return _slashRegistry;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "brief",
    token: "brief",
    labelKey: "slash.brief",
    descKey: "slash.briefDesc",
    kind: "fill",
    isTemplate: true,
    goalKey: "slash.briefGoal",
    registryId: "core.brief",
  },
  {
    id: "research",
    token: "research",
    labelKey: "slash.research",
    descKey: "slash.researchDesc",
    kind: "fill",
    isTemplate: true,
    goalKey: "slash.researchGoal",
    effort: "heavy",
    registryId: "core.research",
  },
  {
    id: "organize",
    token: "organize",
    labelKey: "slash.organize",
    descKey: "slash.organizeDesc",
    kind: "fill",
    isTemplate: true,
    goalKey: "slash.organizeGoal",
  },
  {
    id: "image",
    token: "image",
    labelKey: "slash.image",
    descKey: "slash.imageDesc",
    kind: "fill",
    isTemplate: true,
    goalKey: "slash.imageGoal",
    registryId: "core.image",
  },
  {
    id: "video",
    token: "video",
    labelKey: "slash.video",
    descKey: "slash.videoDesc",
    kind: "fill",
    isTemplate: true,
    goalKey: "slash.videoGoal",
    registryId: "core.video",
  },
  {
    id: "folder",
    token: "folder",
    labelKey: "slash.folder",
    descKey: "slash.folderDesc",
    kind: "action",
    action: "pickFolder",
  },
  {
    id: "schedule",
    token: "schedule",
    labelKey: "slash.schedule",
    descKey: "slash.scheduleDesc",
    kind: "action",
    action: "openSchedule",
  },
  {
    id: "tools",
    token: "tools",
    labelKey: "slash.tools",
    descKey: "slash.toolsDesc",
    kind: "action",
    action: "openTools",
  },
  {
    id: "memory",
    token: "memory",
    labelKey: "slash.memory",
    descKey: "slash.memoryDesc",
    kind: "action",
    action: "openMemory",
  },
  {
    id: "recipe",
    token: "recipe",
    labelKey: "slash.recipe",
    descKey: "slash.recipeDesc",
    kind: "action",
    action: "openRecipes",
  },
  {
    id: "briefing",
    token: "briefing",
    labelKey: "slash.briefing",
    descKey: "slash.briefingDesc",
    kind: "action",
    action: "showBriefing",
  },
  {
    id: "export",
    token: "export",
    labelKey: "slash.export",
    descKey: "slash.exportDesc",
    kind: "action",
    action: "exportPack",
  },
  {
    id: "compact",
    token: "compact",
    labelKey: "slash.compact",
    descKey: "slash.compactDesc",
    kind: "action",
    action: "compact",
    registryId: "core.compact",
  },
  {
    id: "rewind",
    token: "rewind",
    labelKey: "slash.rewind",
    descKey: "slash.rewindDesc",
    kind: "action",
    action: "rewind",
    registryId: "core.rewind",
  },
  {
    id: "remember",
    token: "remember",
    labelKey: "slash.remember",
    descKey: "slash.rememberDesc",
    kind: "action",
    action: "remember",
    registryId: "core.remember",
  },
  {
    id: "monitor",
    token: "watch",
    labelKey: "slash.monitor",
    descKey: "slash.monitorDesc",
    kind: "fill",
    isTemplate: true,
    goalKey: "slash.monitorGoal",
    registryId: "core.monitor",
  },
  {
    id: "deep-research",
    token: "deep-research",
    labelKey: "slash.deepResearch",
    descKey: "slash.deepResearchDesc",
    kind: "fill",
    isTemplate: true,
    goalKey: "slash.deepResearchGoal",
    effort: "heavy",
    registryId: "core.deepResearch",
  },
];

export type SlashQuery = {
  token: string;
  /** Text after the command token (empty when no space yet). */
  args: string;
  start: number;
  end: number;
  /**
   * True once a complete command token is followed by a space ("args mode") —
   * i.e. the user has committed to a command and is now typing arguments. The
   * picker menu closes here so Enter sends instead of re-selecting the command.
   */
  committed: boolean;
};

/** Detect `/token` at the start of the composer (optional trailing args). */
export function extractSlashQuery(
  text: string,
  cursor: number,
  cmds: SlashCommand[] = SLASH_COMMANDS,
): SlashQuery | null {
  if (cursor < 0 || cursor > text.length) return null;
  // Only when the line starts with /
  const before = text.slice(0, cursor);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);
  if (!line.startsWith("/")) return null;
  // Don't treat mid-sentence /paths as slash commands.
  if (lineStart > 0 && text[lineStart - 1] !== "\n") return null;

  // Prefix mode: /token with no space — allow partial tokens for filtering.
  const prefix = /^\/([a-zA-Z0-9_-]*)$/.exec(line);
  if (prefix) {
    return {
      token: (prefix[1] ?? "").toLowerCase(),
      args: "",
      start: lineStart,
      end: cursor,
      committed: false,
    };
  }

  // Args mode: /token <args> — only when the token exactly matches a command.
  // Non-matching tokens with a space close the menu (return null).
  const withArgs = /^\/([a-zA-Z0-9_-]+)\s(.*)$/.exec(line);
  if (!withArgs) return null;
  const token = (withArgs[1] ?? "").toLowerCase();
  const matched = cmds.find((c) => c.token === token || c.id === token);
  if (!matched) return null;
  // Only FILL commands take arguments, so only they "commit" (menu closes, the
  // user types args, Enter sends). ACTION commands take no args — a trailing
  // space must keep the menu open so Enter fires the action; otherwise Enter
  // would send the literal "/token" as a goal.
  return {
    token,
    args: withArgs[2] ?? "",
    start: lineStart,
    end: cursor,
    committed: matched.kind === "fill",
  };
}

/**
 * Filter slash commands by query and optional capability context.
 * Image/video templates are hidden when the provider lacks those modalities.
 */
export function filterSlashCommands(
  query: string,
  cmds: SlashCommand[] = SLASH_COMMANDS,
  capabilityCtx?: CommandContext,
): SlashCommand[] {
  const reg = getSlashCommandRegistry();
  const ctx: CommandContext = capabilityCtx ?? {
    // Default desk Grok path: image/video available as templates (model-dependent).
    capabilities: { image: true, video: true, browser: true, mcp: true },
  };
  let list = cmds.filter((c) => {
    if (!c.registryId) return true;
    const desc = reg.get(c.registryId);
    if (!desc) return true;
    return desc.isAvailable(ctx).available;
  });
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) => c.token.startsWith(q) || c.id.startsWith(q));
}

/** Replace the slash token (and args range) with fill text, or clear it for actions. */
export function applySlashCommand(
  text: string,
  slash: { start: number; end: number },
  fill: string,
): { text: string; cursor: number } {
  const next = text.slice(0, slash.start) + fill + text.slice(slash.end);
  return { text: next, cursor: slash.start + fill.length };
}

/**
 * Weave user args into a fill-command template.
 * `topicLine` is the already-translated "Topic: …" line (i18n resolved by caller).
 */
export function weaveSlashArgs(template: string, args: string, topicLine: string): string {
  const a = args.trim();
  if (!a) return template;
  return `${template}\n\n${topicLine}`;
}

export type ArmedSlash = { command: SlashCommand; args: string };

/** The fill command a composer text is armed with (leading exact token). */
export function armedSlashCommand(
  text: string,
  cmds: SlashCommand[] = SLASH_COMMANDS,
): ArmedSlash | null {
  const m = text.match(/^\/([a-zA-Z0-9_-]+)(?:\s([\s\S]*))?$/);
  if (!m) return null;
  const token = (m[1] ?? "").toLowerCase();
  const cmd = cmds.find(
    (c) => (c.token === token || c.id === token) && c.kind === "fill",
  );
  if (!cmd?.goalKey) return null;
  return { command: cmd, args: (m[2] ?? "").trim() };
}

export type ExpandedGoal = {
  goal: string;
  command: SlashCommand | null;
  /** What the user actually typed (send as goalSource when a command expanded). */
  source: string;
};

/** Send-time swap: leading fill token → full localized template (+ woven args). */
export function expandSlashGoal(
  text: string,
  translate: (key: string, params?: Record<string, string>) => string,
  cmds: SlashCommand[] = SLASH_COMMANDS,
): ExpandedGoal {
  const armed = armedSlashCommand(text, cmds);
  if (!armed) return { goal: text, command: null, source: text };
  const template = translate(armed.command.goalKey!);
  const goal = armed.args
    ? weaveSlashArgs(
        template,
        armed.args,
        translate("slash.argsTopic", { args: armed.args }),
      )
    : template;
  return { goal, command: armed.command, source: text };
}

export type ArmedEffortState = {
  saved: EffortLevel | null;
  applied: EffortLevel | null;
};

/**
 * Effort escalation driven by token recognition (not menu selection).
 * Escalates once when a fill command with effort arms; restores the prior
 * effort on disarm only if the user has not changed the control since.
 */
export function armedEffortTransition(
  state: ArmedEffortState,
  currentEffort: EffortLevel,
  armedEffort: EffortLevel | null,
): { state: ArmedEffortState; set?: EffortLevel } {
  if (armedEffort) {
    if (state.applied === armedEffort) return { state };
    return {
      state: { saved: currentEffort, applied: armedEffort },
      set: armedEffort,
    };
  }
  if (state.applied) {
    const set =
      currentEffort === state.applied && state.saved ? state.saved : undefined;
    return { state: { saved: null, applied: null }, set };
  }
  return { state };
}

/** Stable key for slash-menu dismiss state (Escape suppresses until token changes). */
export function slashDismissKey(q: Pick<SlashQuery, "start" | "token">): string {
  return `${q.start}:${q.token}`;
}

/** Whether the slash menu should render given an active query and dismiss key. */
export function isSlashMenuVisible(
  query: SlashQuery | null,
  dismissedKey: string | null,
  blockedByMention = false,
): boolean {
  if (!query || blockedByMention) return false;
  // Once a command is committed (token + space, now typing args), the picker
  // closes: the ArmedCommandChip takes over and Enter sends instead of the
  // menu swallowing the keystroke to re-select the same command.
  if (query.committed) return false;
  if (dismissedKey == null) return true;
  return slashDismissKey(query) !== dismissedKey;
}
