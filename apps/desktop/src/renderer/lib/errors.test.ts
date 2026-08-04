import { describe, expect, it } from "vitest";
import { humanizeError } from "./errors";

const t = (key: string) => {
  const map: Record<string, string> = {
    "errors.generic": "Something went wrong. Try again.",
    "errors.gateway": "Grok Desk is reconnecting. Try again in a moment.",
    "errors.network": "Network issue. Check your connection.",
    "errors.permission": "Permission needed to continue.",
    "recovery.reauthBody": "Your SuperGrok session expired. Sign in to keep working.",
    "recovery.reauthTitle": "Sign in again",
    "recovery.usageExhaustedTitle": "out",
    "recovery.usageExhaustedBody": "No credits left.",
    "recovery.manageBilling": "Billing",
    "recovery.viewUsage": "Usage",
    "recovery.usageLimitTitle": "limit",
    "recovery.usageLimitBody": "Hit a limit.",
    "recovery.rateLimitedTitle": "rate",
    "recovery.rateLimitedBody": "Slow down.",
    "recovery.dismiss": "OK",
    "recovery.contextTitle": "ctx",
    "recovery.contextBody": "Context full.",
    "recovery.desktopPermissionTitle": "desk",
    "recovery.desktopPermissionBody": "Desk perm.",
    "recovery.desktopPausedTitle": "pause",
    "recovery.desktopPausedBody": "Paused.",
    "recovery.desktopDisabledTitle": "off",
    "recovery.desktopDisabledBody": "Disabled.",
  };
  return map[key] ?? key;
};

describe("humanizeError", () => {
  it("maps known recovery kinds", () => {
    expect(humanizeError(new Error("not logged in — please log in"), t)).toMatch(
      /session expired|Sign in/i,
    );
    expect(humanizeError(new Error("INTERNAL_FOO_BAR"), t)).toBe(
      "Something went wrong. Try again.",
    );
  });

  it("uses generic fallback for empty/garbage", () => {
    expect(humanizeError(new Error(""), t)).toBe(
      "Something went wrong. Try again.",
    );
    expect(humanizeError(new Error("ECONNREFUSED 127.0.0.1"), t)).toMatch(
      /reconnect/i,
    );
  });

  it("passes through short plain messages", () => {
    expect(humanizeError(new Error("Folder not found"), t)).toBe(
      "Folder not found",
    );
  });
});
