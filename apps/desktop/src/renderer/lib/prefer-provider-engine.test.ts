import { describe, it, expect } from "vitest";
import {
  preferProviderEngineFromSettings,
  preferProviderEngineSetPayload,
} from "./prefer-provider-engine";

describe("preferProviderEngine helpers", () => {
  it("defaults unknown/falsey to false", () => {
    expect(preferProviderEngineFromSettings(undefined)).toBe(false);
    expect(preferProviderEngineFromSettings(null)).toBe(false);
    expect(preferProviderEngineFromSettings(false)).toBe(false);
    expect(preferProviderEngineFromSettings("1")).toBe(false);
    expect(preferProviderEngineFromSettings(1)).toBe(false);
  });

  it("accepts true only", () => {
    expect(preferProviderEngineFromSettings(true)).toBe(true);
  });

  it("builds set payload", () => {
    expect(preferProviderEngineSetPayload(true)).toEqual({
      preferProviderEngine: true,
    });
    expect(preferProviderEngineSetPayload(false)).toEqual({
      preferProviderEngine: false,
    });
  });
});
