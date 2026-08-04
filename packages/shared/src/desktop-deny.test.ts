import { describe, it, expect } from "vitest";
import {
  isDeniedDesktopTarget,
  isCautionDesktopTarget,
} from "./desktop-deny.js";

describe("desktop-deny", () => {
  it("blocks password managers by process name", () => {
    expect(isDeniedDesktopTarget("1Password", null)).toBe(true);
    expect(isDeniedDesktopTarget("Bitwarden", "Vault")).toBe(true);
    expect(isDeniedDesktopTarget("KeePassXC", null)).toBe(true);
  });

  it("allows normal apps", () => {
    expect(isDeniedDesktopTarget("Numbers", "Budget")).toBe(false);
    expect(isDeniedDesktopTarget("Code", "main.ts")).toBe(false);
  });

  it("flags caution for login-looking titles without hard block", () => {
    expect(isCautionDesktopTarget("Chrome", "Sign in - Google")).toBe(true);
    expect(isDeniedDesktopTarget("Chrome", "Sign in - Google")).toBe(false);
  });

  it("handles null/empty", () => {
    expect(isDeniedDesktopTarget(null, null)).toBe(false);
    expect(isDeniedDesktopTarget("", "")).toBe(false);
  });
});
