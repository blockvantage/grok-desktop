/**
 * Computer-use / desktop GUI control shared types.
 * Pure — no Electron imports.
 */

export type DesktopTool =
  | "desktop_screenshot"
  | "desktop_mouse_move"
  | "desktop_click"
  | "desktop_double_click"
  | "desktop_drag"
  | "desktop_type"
  | "desktop_key"
  | "desktop_scroll"
  | "desktop_wait"
  | "desktop_open_app"
  | "desktop_list_displays";

export const DESKTOP_TOOLS: readonly DesktopTool[] = [
  "desktop_screenshot",
  "desktop_mouse_move",
  "desktop_click",
  "desktop_double_click",
  "desktop_drag",
  "desktop_type",
  "desktop_key",
  "desktop_scroll",
  "desktop_wait",
  "desktop_open_app",
  "desktop_list_displays",
] as const;

export function isDesktopTool(value: string): value is DesktopTool {
  return (DESKTOP_TOOLS as readonly string[]).includes(value);
}

/** MCP name "desktop.click" → internal "desktop_click" */
export function mcpDesktopNameToTool(name: string): DesktopTool | null {
  const internal = name.replace(/\./g, "_");
  return isDesktopTool(internal) ? internal : null;
}

export type DesktopErrorCode =
  | "desktop_disabled_machine"
  | "desktop_disabled_task"
  | "desktop_paused"
  | "desktop_permission_capture"
  | "desktop_permission_input"
  | "desktop_yielded"
  | "desktop_rate_limited"
  | "desktop_denied_target"
  | "desktop_invalid_args"
  | "desktop_display_not_found"
  | "desktop_capture_failed"
  | "desktop_input_failed"
  | "desktop_open_app_failed"
  | "desktop_not_supported";

export interface DesktopDisplayInfo {
  id: string;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  bounds: { x: number; y: number; width: number; height: number };
  isPrimary: boolean;
}

export interface DesktopExecArgs {
  taskId: string;
  tool: DesktopTool;
  args: Record<string, unknown>;
}

export interface DesktopExecResult {
  ok: boolean;
  output: string;
  code?: DesktopErrorCode;
  screenshot?: string;
  width?: number;
  height?: number;
  displayId?: string;
  scaleFactor?: number;
  imageToDeviceScale?: number;
  displays?: DesktopDisplayInfo[];
  frontmostApp?: string | null;
  frontmostWindowTitle?: string | null;
}

export interface DesktopMachineSettings {
  /** Master switch — default false */
  enabled: boolean;
  /** Preferred display id; null = primary */
  defaultDisplayId: string | null;
  /** Max actions per rolling 60s window — default 60 */
  maxActionsPerMinute: number;
  /** Max actions per task lifetime — default 2000 */
  maxActionsPerTask: number;
  /** Screenshot long-edge max px for model — default 1280 */
  maxScreenshotLongEdge: number;
  screenshotFormat: "png" | "jpeg";
  screenshotJpegQuality: number;
}

export interface DesktopTaskState {
  taskId: string;
  granted: boolean;
  displayId: string | null;
  actionCount: number;
  windowStartedAt: number;
  windowActionCount: number;
  softPaused: boolean;
}

export interface DesktopPermissionStatus {
  captureGranted: boolean;
  inputGranted: boolean;
  captureDetail: string;
  inputDetail: string;
  platform: "darwin" | "win32" | "other";
}

export interface DesktopStatusEvent {
  taskId: string;
  active: boolean;
  exclusive: boolean;
  softPaused: boolean;
  lastAction: string | null;
  lastError: string | null;
  lastScreenshotDataUrl: string | null;
  frontmostApp: string | null;
  displayId: string | null;
  updatedAt: string;
}

export const DEFAULT_DESKTOP_MACHINE_SETTINGS: DesktopMachineSettings = {
  enabled: false,
  defaultDisplayId: null,
  maxActionsPerMinute: 60,
  maxActionsPerTask: 2000,
  maxScreenshotLongEdge: 1280,
  screenshotFormat: "jpeg",
  screenshotJpegQuality: 75,
};

/** Feature flag — true when dual adapters ship. */
export const DESKTOP_CONTROL_FEATURE_ENABLED = true;

export const DESKTOP_RECOVERY_COPY: Record<DesktopErrorCode, string> = {
  desktop_disabled_machine:
    "Turn on Desktop control in Settings → Permissions.",
  desktop_disabled_task:
    "Enable Desktop for this chat to let Grok use the screen.",
  desktop_paused: "Tasks are paused. Resume from the tray or task bar.",
  desktop_permission_capture:
    "Grant Screen Recording to Grok Desk in System Settings.",
  desktop_permission_input:
    "Grant Accessibility (mouse and keyboard) to Grok Desk.",
  desktop_yielded:
    "You moved the mouse or typed — desktop control paused. Click Resume when ready.",
  desktop_rate_limited:
    "Too many desktop actions — wait a moment or raise limits in Permissions.",
  desktop_denied_target:
    "Blocked: sensitive app (password manager / security). Complete this step yourself.",
  desktop_invalid_args: "Invalid desktop action arguments.",
  desktop_display_not_found:
    "That display is not available. Call list_displays.",
  desktop_capture_failed:
    "Could not capture the screen. Check permissions and try again.",
  desktop_input_failed:
    "Could not control the mouse/keyboard. Check Accessibility permissions.",
  desktop_open_app_failed: "Could not open that app. Check the name or path.",
  desktop_not_supported:
    "Desktop control is not supported on this platform.",
};
