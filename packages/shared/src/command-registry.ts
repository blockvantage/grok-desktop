/**
 * Typed command catalog (CMD-01 / Phase 5 foundations).
 * Slash macros and skills merge through one registry with availability gates.
 */

export type CommandSource = "core" | "skill" | "provider" | "workspace";

export type CommandConfirmation = "none" | "preview" | "always";

export type CommandKind = "action" | "template";

export interface CommandAvailability {
  available: boolean;
  reason?: string;
}

export interface CommandContext {
  providerId?: string;
  modelId?: string;
  capabilities?: {
    image?: boolean;
    video?: boolean;
    browser?: boolean;
    desktop?: boolean;
    mcp?: boolean;
  };
  locale?: string;
}

export interface CommandReceipt {
  commandId: string;
  ok: boolean;
  kind: CommandKind;
  message?: string;
  /** Never include secrets. */
  detail?: Record<string, unknown>;
}

export interface CommandDescriptor<Args = unknown> {
  id: string;
  source: CommandSource;
  kind: CommandKind;
  /** User-visible title (may be localized at display time). */
  title: string;
  description?: string;
  /** When kind is template, this is a prompt template — not a deterministic action. */
  template?: string;
  confirmation: CommandConfirmation;
  isAvailable(ctx: CommandContext): CommandAvailability;
  /** Optional args validation hook (caller may use zod separately). */
  parseArgs?: (raw: unknown) => Args;
  execute?(args: Args, ctx: CommandContext): Promise<CommandReceipt>;
}

export class CommandRegistry {
  private commands = new Map<string, CommandDescriptor>();

  register(cmd: CommandDescriptor): void {
    if (this.commands.has(cmd.id)) {
      throw new Error(`Command already registered: ${cmd.id}`);
    }
    this.commands.set(cmd.id, cmd);
  }

  get(id: string): CommandDescriptor | undefined {
    return this.commands.get(id);
  }

  list(ctx?: CommandContext): CommandDescriptor[] {
    const all = [...this.commands.values()];
    if (!ctx) return all;
    return all.filter((c) => c.isAvailable(ctx).available);
  }

  listUnavailable(ctx: CommandContext): Array<{
    command: CommandDescriptor;
    reason?: string;
  }> {
    return [...this.commands.values()]
      .map((c) => ({ command: c, ...c.isAvailable(ctx) }))
      .filter((x) => !x.available)
      .map((x) => ({ command: x.command, reason: x.reason }));
  }
}

/** Core Desk commands — templates labeled as templates (CMD-01). */
export function registerCoreCommands(reg: CommandRegistry): void {
  const always = (): CommandAvailability => ({ available: true });

  reg.register({
    id: "core.brief",
    source: "core",
    kind: "template",
    title: "Brief",
    description: "Prompt template for a concise brief",
    template: "Write a concise brief about: {{input}}",
    confirmation: "none",
    isAvailable: always,
  });

  reg.register({
    id: "core.research",
    source: "core",
    kind: "template",
    title: "Research",
    description: "Prompt template for research",
    template: "Research thoroughly and cite sources: {{input}}",
    confirmation: "none",
    isAvailable: always,
  });

  reg.register({
    id: "core.image",
    source: "core",
    kind: "template",
    title: "Image",
    description: "Image generation prompt template (capability-gated)",
    template: "Generate an image: {{input}}",
    confirmation: "preview",
    isAvailable: (ctx) =>
      ctx.capabilities?.image
        ? { available: true }
        : { available: false, reason: "Image modality unavailable for provider" },
  });

  reg.register({
    id: "core.video",
    source: "core",
    kind: "template",
    title: "Video",
    description: "Video generation prompt template (capability-gated)",
    template: "Generate a video: {{input}}",
    confirmation: "preview",
    isAvailable: (ctx) =>
      ctx.capabilities?.video
        ? { available: true }
        : { available: false, reason: "Video modality unavailable for provider" },
  });

  reg.register({
    id: "core.schedule",
    source: "core",
    kind: "action",
    title: "Schedule",
    description: "Open schedule action",
    confirmation: "none",
    isAvailable: always,
    async execute(_args, _ctx) {
      return {
        commandId: "core.schedule",
        ok: true,
        kind: "action",
        message: "schedule_ui",
      };
    },
  });

  reg.register({
    id: "core.compact",
    source: "core",
    kind: "action",
    title: "Summarize so far",
    description: "Compact earlier conversation (task.compact)",
    confirmation: "none",
    isAvailable: always,
    async execute() {
      return {
        commandId: "core.compact",
        ok: true,
        kind: "action",
        message: "compact",
      };
    },
  });

  reg.register({
    id: "core.rewind",
    source: "core",
    kind: "action",
    title: "Undo last turn",
    description: "Rewind the conversation (task.rewind)",
    confirmation: "preview",
    isAvailable: always,
    async execute() {
      return {
        commandId: "core.rewind",
        ok: true,
        kind: "action",
        message: "rewind",
      };
    },
  });

  reg.register({
    id: "core.remember",
    source: "core",
    kind: "action",
    title: "Remember this",
    description: "Save takeaways (memory.create)",
    confirmation: "none",
    isAvailable: always,
    async execute() {
      return {
        commandId: "core.remember",
        ok: true,
        kind: "action",
        message: "remember",
      };
    },
  });

  reg.register({
    id: "core.monitor",
    source: "core",
    kind: "template",
    title: "Watch this until…",
    description: "Prompt template for a watch-until monitor (Phase 3)",
    template: "Watch this until the condition is met, then tell me what changed: {{input}}",
    confirmation: "none",
    isAvailable: always,
  });

  reg.register({
    id: "core.loop",
    source: "core",
    kind: "template",
    title: "Check this on a schedule",
    description: "Bridge a repeating in-chat check into Desk schedules",
    template: "every 30m {{input}}",
    confirmation: "preview",
    isAvailable: always,
  });

  reg.register({
    id: "core.deepResearch",
    source: "core",
    kind: "template",
    title: "Deep research",
    description: "Prompt template for a phased research workflow (Phase 3)",
    template:
      "Run a deep research workflow on this topic. Break it into phases, cite sources, and save notes under ./artifacts: {{input}}",
    confirmation: "none",
    isAvailable: always,
  });
}
