import { describe, it, expect } from "vitest";
import {
  createDesktopAdapter,
  adapterClassNameForPlatform,
} from "./select-adapter";
import { MacDesktopAdapter } from "./mac-adapter";
import { WinDesktopAdapter } from "./win-adapter";
import { UnsupportedDesktopAdapter } from "./unsupported-adapter";

describe("createDesktopAdapter", () => {
  it("selects MacDesktopAdapter for darwin", () => {
    const a = createDesktopAdapter("darwin");
    expect(a).toBeInstanceOf(MacDesktopAdapter);
    expect(a.platform).toBe("darwin");
    expect(adapterClassNameForPlatform("darwin")).toBe("MacDesktopAdapter");
  });

  it("selects WinDesktopAdapter for win32", () => {
    const a = createDesktopAdapter("win32");
    expect(a).toBeInstanceOf(WinDesktopAdapter);
    expect(a.platform).toBe("win32");
    expect(adapterClassNameForPlatform("win32")).toBe("WinDesktopAdapter");
  });

  it("selects Unsupported for other platforms", () => {
    const a = createDesktopAdapter("linux");
    expect(a).toBeInstanceOf(UnsupportedDesktopAdapter);
    expect(a.platform).toBe("other");
  });

  it("both adapter modules export permission probes and open-settings", () => {
    const mac = new MacDesktopAdapter();
    const win = new WinDesktopAdapter();
    expect(typeof mac.getPermissionStatus).toBe("function");
    expect(typeof mac.openCaptureSettings).toBe("function");
    expect(typeof mac.openInputSettings).toBe("function");
    expect(typeof win.getPermissionStatus).toBe("function");
    expect(typeof win.openCaptureSettings).toBe("function");
    expect(typeof win.openInputSettings).toBe("function");
  });
});
