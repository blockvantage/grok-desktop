import { afterEach, describe, expect, it } from "vitest";
import {
  getActiveIntlLocale,
  getActiveLocale,
  setActiveLocale,
} from "./active.js";

describe("getActiveIntlLocale", () => {
  afterEach(() => {
    setActiveLocale("en");
  });

  it("maps zh to zh-CN for Intl formatting", () => {
    setActiveLocale("zh");
    expect(getActiveLocale()).toBe("zh");
    expect(getActiveIntlLocale()).toBe("zh-CN");
  });

  it("passes other locales through unchanged", () => {
    setActiveLocale("de");
    expect(getActiveIntlLocale()).toBe("de");
    setActiveLocale("ja");
    expect(getActiveIntlLocale()).toBe("ja");
    setActiveLocale("fr");
    expect(getActiveIntlLocale()).toBe("fr");
    setActiveLocale("en");
    expect(getActiveIntlLocale()).toBe("en");
  });
});
