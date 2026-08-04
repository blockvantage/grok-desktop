import { z } from "zod";
import {
  isDesktopTool,
  type DesktopTool,
  type DesktopErrorCode,
} from "./desktop-types.js";

const buttonSchema = z.enum(["left", "right", "middle"]).default("left");

/** Image-space coordinates — large enough for multi-monitor, small enough to reject garbage. */
const coord = z.number().finite().min(-100_000).max(100_000);
const scrollDelta = z.number().finite().min(-10_000).max(10_000);

const schemas: Record<DesktopTool, z.ZodType<Record<string, unknown>>> = {
  desktop_screenshot: z
    .object({
      displayId: z.string().min(1).max(64).optional(),
    })
    .passthrough(),
  desktop_mouse_move: z
    .object({
      x: coord,
      y: coord,
    })
    .passthrough(),
  desktop_click: z
    .object({
      x: coord,
      y: coord,
      button: buttonSchema.optional(),
      count: z.number().int().min(1).max(3).optional(),
    })
    .passthrough(),
  desktop_double_click: z
    .object({
      x: coord,
      y: coord,
    })
    .passthrough(),
  desktop_drag: z
    .object({
      x1: coord,
      y1: coord,
      x2: coord,
      y2: coord,
      durationMs: z.number().min(0).max(5000).optional(),
    })
    .passthrough(),
  desktop_type: z
    .object({
      text: z.string().max(8000),
    })
    .passthrough(),
  desktop_key: z
    .object({
      key: z.string().min(1).max(64),
      modifiers: z.array(z.string().max(32)).max(4).optional(),
    })
    .passthrough(),
  desktop_scroll: z
    .object({
      x: coord,
      y: coord,
      dx: scrollDelta.optional(),
      dy: scrollDelta.optional(),
    })
    .passthrough()
    .superRefine((v, ctx) => {
      if (v.dx == null && v.dy == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "dx or dy required",
        });
      }
    }),
  desktop_wait: z
    .object({
      ms: z.number().min(0).max(30_000).optional(),
    })
    .passthrough(),
  desktop_open_app: z
    .object({
      name: z.string().min(1).max(512).optional(),
      path: z.string().min(1).max(4096).optional(),
    })
    .passthrough()
    .superRefine((v, ctx) => {
      if (!v.name && !v.path) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "name or path required",
        });
      }
    }),
  desktop_list_displays: z.object({}).passthrough(),
};

export type ParseDesktopArgsResult =
  | { ok: true; tool: DesktopTool; args: Record<string, unknown> }
  | { ok: false; code: DesktopErrorCode; output: string };

export function parseDesktopToolArgs(
  tool: string,
  args: Record<string, unknown>,
): ParseDesktopArgsResult {
  if (!isDesktopTool(tool)) {
    return {
      ok: false,
      code: "desktop_invalid_args",
      output: `Unknown desktop tool: ${tool}`,
    };
  }
  const schema = schemas[tool];
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      code: "desktop_invalid_args",
      output:
        parsed.error.issues.map((i) => i.message).join("; ") ||
        "Invalid desktop action arguments.",
    };
  }
  return { ok: true, tool, args: parsed.data as Record<string, unknown> };
}

/** Normalize key names to a closed set. */
export function normalizeDesktopKey(key: string): string {
  const k = key.trim().toLowerCase();
  const map: Record<string, string> = {
    return: "enter",
    esc: "escape",
    " ": "space",
    arrowup: "up",
    arrowdown: "down",
    arrowleft: "left",
    arrowright: "right",
    pgup: "pageup",
    pgdn: "pagedown",
    page_up: "pageup",
    page_down: "pagedown",
  };
  return map[k] ?? k;
}

export function normalizeModifiers(mods: unknown): string[] {
  if (!Array.isArray(mods)) return [];
  return mods
    .map((m) => String(m).toLowerCase())
    .map((m) => {
      if (m === "command" || m === "cmd" || m === "meta" || m === "super")
        return "cmd";
      if (m === "control" || m === "ctl") return "ctrl";
      if (m === "option" || m === "opt") return "alt";
      return m;
    })
    .filter((m) => ["cmd", "ctrl", "alt", "shift"].includes(m));
}
