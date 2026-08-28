// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  isAppearancePreference,
  loadAppearancePreference,
  resolveAppearance,
  storeAppearancePreference,
} from "./appearance";

describe("appearance", () => {
  afterEach(() => {
    try {
      localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    } catch {
      /* node */
    }
    if (typeof document !== "undefined") {
      delete document.documentElement.dataset.theme;
      document.documentElement.style.colorScheme = "";
    }
  });

  it("treats dark as the crafted default", () => {
    expect(loadAppearancePreference()).toBe("dark");
    expect(isAppearancePreference("dark")).toBe(true);
    expect(isAppearancePreference("dim")).toBe(false);
  });

  it("system follows the OS color scheme", () => {
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });

  it("persists a user preference", () => {
    storeAppearancePreference("light");
    expect(loadAppearancePreference()).toBe("light");
    storeAppearancePreference("system");
    expect(loadAppearancePreference()).toBe("system");
  });

  it("stamps data-theme and color-scheme on the document", () => {
    applyAppearance("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    applyAppearance("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
