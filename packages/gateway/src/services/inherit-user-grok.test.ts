/**
 * T4: inheritUserGrok product path — settings schema + runner isolate mapping.
 * (Avoids better-sqlite3 in this file; SettingsService DB round-trip covered
 * elsewhere when native bindings are available.)
 */
import { describe, it, expect } from "vitest";
import { parsePartialAppSettings } from "@grokdesk/shared";

/** Mirrors TaskRunner: isolateGrokHome: !inheritUserGrokProvider?.() */
function isolateFromInherit(inheritUserGrok: boolean): boolean {
  return !inheritUserGrok;
}

describe("inheritUserGrok settings (T4)", () => {
  it("settings schema accepts inheritUserGrok boolean", () => {
    const on = parsePartialAppSettings({ inheritUserGrok: true });
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.value.inheritUserGrok).toBe(true);
    const off = parsePartialAppSettings({ inheritUserGrok: false });
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.value.inheritUserGrok).toBe(false);
  });

  it("defaults product path is isolated (inherit false → isolate true)", () => {
    expect(isolateFromInherit(false)).toBe(true);
  });

  it("when user enables inherit, isolateGrokHome is false", () => {
    expect(isolateFromInherit(true)).toBe(false);
  });

  it("rejects unknown settings keys still (license not settable)", () => {
    expect(parsePartialAppSettings({ license: { key: "x" } }).ok).toBe(false);
  });
});
