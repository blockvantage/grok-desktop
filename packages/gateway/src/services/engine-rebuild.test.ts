import { describe, it, expect, vi } from "vitest";
import { applyEngineSettingsRebuild } from "./engine-rebuild.js";
import type { AppSettings } from "./settings.js";
import type { EngineAdapter } from "../engine-types.js";

function settings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    maxConcurrentTasks: 2,
    mcpServers: [],
    skillsPaths: [],
    defaultApprovalMode: "balanced",
    onboardingCompleted: true,
    license: null,
    desktopControl: null,
    ...over,
  } as AppSettings;
}

describe("applyEngineSettingsRebuild", () => {
  it("returns false without runner", async () => {
    const r = await applyEngineSettingsRebuild(settings(), settings(), {
      hasRunner: false,
      hasEngineOverride: false,
      setMaxConcurrent: vi.fn(),
      settingsChanged: () => true,
      createEngine: vi.fn(),
      setEngine: vi.fn(),
    });
    expect(r).toBe(false);
  });

  it("updates concurrency and skips rebuild on engine override", async () => {
    const setMax = vi.fn();
    const create = vi.fn();
    const r = await applyEngineSettingsRebuild(
      settings(),
      settings({ maxConcurrentTasks: 5 }),
      {
        hasRunner: true,
        hasEngineOverride: true,
        setMaxConcurrent: setMax,
        settingsChanged: () => true,
        createEngine: create,
        setEngine: vi.fn(),
      },
    );
    expect(setMax).toHaveBeenCalledWith(5);
    expect(create).not.toHaveBeenCalled();
    expect(r).toBe(false);
  });

  it("rebuilds when settingsChanged and wires afterRebuild", async () => {
    const engine = { run: vi.fn(), cancel: vi.fn() } as unknown as EngineAdapter;
    const setEngine = vi.fn();
    const after = vi.fn();
    const r = await applyEngineSettingsRebuild(
      settings({ skillsPaths: [] }),
      settings({ skillsPaths: ["/extra"] }),
      {
        hasRunner: true,
        hasEngineOverride: false,
        setMaxConcurrent: vi.fn(),
        settingsChanged: () => true,
        createEngine: async () => engine,
        setEngine,
        afterRebuild: after,
      },
    );
    expect(r).toBe(true);
    expect(setEngine).toHaveBeenCalledWith(engine);
    expect(after).toHaveBeenCalled();
  });

  it("does not rebuild when settingsChanged is false", async () => {
    const create = vi.fn();
    const r = await applyEngineSettingsRebuild(settings(), settings(), {
      hasRunner: true,
      hasEngineOverride: false,
      setMaxConcurrent: vi.fn(),
      settingsChanged: () => false,
      createEngine: create,
      setEngine: vi.fn(),
    });
    expect(r).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
