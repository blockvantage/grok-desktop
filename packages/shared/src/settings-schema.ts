/**
 * Partial AppSettings validation for settings.set.
 * Single source of truth for wire schema (ipc) and gateway service.
 * license is never a settable field (stripped at IPC; rejected at gateway).
 */
import { z } from "zod";
import { DEFAULT_DESKTOP_MACHINE_SETTINGS } from "./desktop-types.js";

/** MCP server row as stored in settings.mcpServers. */
export const mcpServerRowSchema = z.object({
  id: z.string().min(1).max(128),
  command: z.string().min(1).max(512),
  args: z.array(z.string().max(4096)).max(64),
  env: z.record(z.string().max(256), z.string().max(8192)).optional(),
  enabled: z.boolean(),
});

const quietHoursSchema = z
  .object({
    start: z.string().regex(/^\d{1,2}:\d{2}$/),
    end: z.string().regex(/^\d{1,2}:\d{2}$/),
    timezone: z.string().max(64).optional(),
  })
  .nullable();

export const desktopControlSettingsSchema = z.object({
  enabled: z.boolean(),
  defaultDisplayId: z.string().max(64).nullable(),
  maxActionsPerMinute: z.number().int().min(1).max(600),
  maxActionsPerTask: z.number().int().min(1).max(100_000),
  maxScreenshotLongEdge: z.number().int().min(320).max(4096),
  screenshotFormat: z.enum(["png", "jpeg"]),
  screenshotJpegQuality: z.number().int().min(1).max(100),
});

/** Keys allowed via settings.set IPC (license is license.* only). */
export const APP_SETTINGS_SETTABLE_KEYS = [
  "maxConcurrentTasks",
  "preferProviderEngine",
  "quietHours",
  "defaultModel",
  "defaultEffort",
  "defaultApprovalMode",
  "mcpServers",
  "skillsPaths",
  "desktopControl",
  "onboardingCompleted",
  /** T4: use personal ~/.grok plugins & hooks (off by default; risk dialog in UI). */
  "inheritUserGrok",
  /** T5: absolute paths trusted for project tools (soft folder trust). */
  "trustedFolders",
  /** Phase 3.3: weekly recap inbox item (default on). */
  "weeklyRecapEnabled",
] as const;

export type SettableSettingsKey = (typeof APP_SETTINGS_SETTABLE_KEYS)[number];

/**
 * Partial AppSettings for settings.set.
 * Unknown keys (including license) are stripped by Zod — not rejected here.
 * Gateway parsePartialAppSettings still rejects unknown keys as a second belt.
 */
export const partialAppSettingsSchema = z
  .object({
    maxConcurrentTasks: z.number().int().min(1).max(8),
    /** Opt-in AgentProvider engine path (default false — no silent cutover). */
    preferProviderEngine: z.boolean(),
    quietHours: quietHoursSchema,
    defaultModel: z.string().min(1).max(128),
    defaultEffort: z.enum(["fast", "normal", "heavy"]),
    defaultApprovalMode: z.enum(["strict", "balanced", "autopilot"]),
    mcpServers: z.array(mcpServerRowSchema).max(64),
    skillsPaths: z
      .array(
        z
          .string()
          .min(1)
          .max(1024)
          .refine(
            (p) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p),
            "skills path must be absolute",
          ),
      )
      .max(32),
    desktopControl: desktopControlSettingsSchema,
    onboardingCompleted: z.boolean().optional(),
    /**
     * When true, runs inherit the user Grok profile (plugins/hooks).
     * Default false — isolated GROK_HOME. Product path for T4 (not env-only).
     */
    inheritUserGrok: z.boolean().optional(),
    /** T5: folders trusted for project-local tools (max 64 paths, absolute only). */
    trustedFolders: z
      .array(
        z
          .string()
          .min(1)
          .max(1024)
          .refine(
            (p) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p),
            "trusted folder must be an absolute path",
          ),
      )
      .max(64)
      .optional(),
    weeklyRecapEnabled: z.boolean().optional(),
  })
  .partial();

/** Merge partial desktopControl with defaults (enabled remains false unless set). */
export function mergeDesktopControlSettings(
  partial: unknown,
): z.infer<typeof desktopControlSettingsSchema> {
  const base = { ...DEFAULT_DESKTOP_MACHINE_SETTINGS };
  if (partial == null || typeof partial !== "object") return base;
  const parsed = desktopControlSettingsSchema.partial().safeParse(partial);
  if (!parsed.success) return base;
  return { ...base, ...parsed.data };
}

export type PartialAppSettingsInput = z.infer<typeof partialAppSettingsSchema>;

/**
 * Gateway-side validation: rejects unknown keys (incl. license) and invalid types.
 * Built on partialAppSettingsSchema so field rules cannot drift from the wire schema.
 */
export function parsePartialAppSettings(
  input: unknown,
):
  | { ok: true; value: PartialAppSettingsInput }
  | { ok: false; error: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "settings must be an object" };
  }
  const obj = input as Record<string, unknown>;
  // Reject license and any other unknown keys so clients cannot inject activation.
  const allowed = new Set<string>(APP_SETTINGS_SETTABLE_KEYS);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        error: `settings key not allowed: ${key}`,
      };
    }
  }
  const parsed = partialAppSettingsSchema.safeParse(obj);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; ") || "invalid",
    };
  }
  return { ok: true, value: parsed.data };
}

/** Clamp concurrency for runner constructor (never 0; max 8). */
export function clampMaxConcurrent(n: unknown, fallback = 3): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(8, Math.max(1, Math.floor(v)));
}
