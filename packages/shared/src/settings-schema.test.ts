import { describe, it, expect } from "vitest";
import {
  parsePartialAppSettings,
  clampMaxConcurrent,
  mergeDesktopControlSettings,
} from "./settings-schema.js";

describe("settings-schema", () => {
  it("accepts valid partial settings", () => {
    const r = parsePartialAppSettings({ maxConcurrentTasks: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.maxConcurrentTasks).toBe(2);
  });

  it("rejects license and unknown keys", () => {
    expect(parsePartialAppSettings({ license: { key: "x" } }).ok).toBe(false);
    expect(parsePartialAppSettings({ notAKey: 1 }).ok).toBe(false);
  });

  it("accepts onboardingCompleted boolean", () => {
    const r = parsePartialAppSettings({ onboardingCompleted: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.onboardingCompleted).toBe(true);
  });

  it("accepts deskSignedOut boolean", () => {
    const on = parsePartialAppSettings({ deskSignedOut: true });
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.value.deskSignedOut).toBe(true);
    const off = parsePartialAppSettings({ deskSignedOut: false });
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.value.deskSignedOut).toBe(false);
  });

  it("accepts requireSandboxForAutopilot boolean", () => {
    const on = parsePartialAppSettings({ requireSandboxForAutopilot: true });
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.value.requireSandboxForAutopilot).toBe(true);
  });

  it("accepts weeklyRecapEnabled boolean", () => {
    const on = parsePartialAppSettings({ weeklyRecapEnabled: true });
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.value.weeklyRecapEnabled).toBe(true);
    const off = parsePartialAppSettings({ weeklyRecapEnabled: false });
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.value.weeklyRecapEnabled).toBe(false);
  });

  it("accepts inheritUserGrok boolean (T4)", () => {
    const r = parsePartialAppSettings({ inheritUserGrok: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.inheritUserGrok).toBe(true);
  });

  it("accepts trustedFolders array (T5)", () => {
    const r = parsePartialAppSettings({
      trustedFolders: ["/Users/me/proj"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.trustedFolders).toEqual(["/Users/me/proj"]);
  });

  it("rejects relative trustedFolders (T5)", () => {
    expect(
      parsePartialAppSettings({
        trustedFolders: ["relative/proj"],
      }).ok,
    ).toBe(false);
  });

  it("rejects relative skillsPaths", () => {
    expect(
      parsePartialAppSettings({
        skillsPaths: ["./skills"],
      }).ok,
    ).toBe(false);
    expect(
      parsePartialAppSettings({
        skillsPaths: ["/abs/skills"],
      }).ok,
    ).toBe(true);
  });

  it("rejects maxConcurrentTasks < 1", () => {
    expect(parsePartialAppSettings({ maxConcurrentTasks: 0 }).ok).toBe(false);
  });

  it("accepts desktopControl with enabled default false via merge", () => {
    const merged = mergeDesktopControlSettings(undefined);
    expect(merged.enabled).toBe(false);
    const r = parsePartialAppSettings({
      desktopControl: {
        enabled: true,
        defaultDisplayId: null,
        maxActionsPerMinute: 30,
        maxActionsPerTask: 100,
        maxScreenshotLongEdge: 1280,
        screenshotFormat: "jpeg",
        screenshotJpegQuality: 75,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.desktopControl?.enabled).toBe(true);
  });

  it("clampMaxConcurrent never returns 0 and caps at 8", () => {
    expect(clampMaxConcurrent(0)).toBe(1);
    expect(clampMaxConcurrent(-1)).toBe(1);
    expect(clampMaxConcurrent(5)).toBe(5);
    expect(clampMaxConcurrent(100)).toBe(8);
    expect(clampMaxConcurrent(NaN)).toBe(3);
  });
});
