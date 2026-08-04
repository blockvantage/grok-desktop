import type { DesktopAdapter } from "./types";
import { MacDesktopAdapter } from "./mac-adapter";
import { WinDesktopAdapter } from "./win-adapter";
import { UnsupportedDesktopAdapter } from "./unsupported-adapter";

/**
 * Select platform adapter by process.platform.
 * Both Mac and Win modules are always imported so packaging includes both.
 */
export function createDesktopAdapter(
  platform: NodeJS.Platform = process.platform,
): DesktopAdapter {
  if (platform === "darwin") return new MacDesktopAdapter();
  if (platform === "win32") return new WinDesktopAdapter();
  return new UnsupportedDesktopAdapter();
}

export function adapterClassNameForPlatform(
  platform: NodeJS.Platform,
): "MacDesktopAdapter" | "WinDesktopAdapter" | "UnsupportedDesktopAdapter" {
  if (platform === "darwin") return "MacDesktopAdapter";
  if (platform === "win32") return "WinDesktopAdapter";
  return "UnsupportedDesktopAdapter";
}
