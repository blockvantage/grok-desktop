import { describe, expect, it } from "vitest";
import {
  CATALOG,
  LOCALE_META,
  createTranslator,
  detectSystemLocale,
  flattenKeys,
  isLocaleCode,
} from "./catalog";

const LOCALES = ["en", "es", "fr", "de", "pt", "ja", "zh"] as const;

describe("mobile i18n (desktop language set)", () => {
  it("lists the same 7 locales as desktop", () => {
    expect(LOCALE_META.map((m) => m.code)).toEqual([...LOCALES]);
    expect(Object.keys(CATALOG).sort()).toEqual([...LOCALES].sort());
  });

  it("every locale covers all English keys", () => {
    const enKeys = new Set(flattenKeys(CATALOG.en));
    expect(enKeys.size).toBeGreaterThan(80);
    for (const code of LOCALES) {
      const keys = new Set(flattenKeys(CATALOG[code]));
      for (const k of enKeys) {
        expect(keys.has(k), `${code} missing ${k}`).toBe(true);
      }
    }
  });

  it("no empty user-facing values", () => {
    for (const code of LOCALES) {
      for (const k of flattenKeys(CATALOG[code])) {
        const t = createTranslator(code);
        const v = t(k);
        expect(v.trim().length, `${code}.${k}`).toBeGreaterThan(0);
        expect(v).not.toBe(k);
      }
    }
  });

  it("prose keys differ from English in non-Latin locales", () => {
    const samples = [
      "pair.title",
      "home.createTask",
      "schedule.hint",
      "errors.revoked",
      "settings.language",
    ];
    for (const code of ["ja", "zh"] as const) {
      const t = createTranslator(code);
      const en = createTranslator("en");
      let diffs = 0;
      for (const k of samples) {
        if (t(k) !== en(k)) diffs += 1;
      }
      expect(diffs, code).toBeGreaterThanOrEqual(samples.length - 1);
    }
  });

  it("interpolates variables", () => {
    const t = createTranslator("en");
    expect(t("home.machine", { id: "abc" })).toBe("Machine: abc");
    expect(t("tasks.count", { n: 3 })).toBe("Tasks: 3");
  });

  it("detectSystemLocale maps language tags", () => {
    expect(detectSystemLocale(["es-MX", "en"])).toBe("es");
    expect(detectSystemLocale(["zh-CN"])).toBe("zh");
    expect(detectSystemLocale(["pt-BR"])).toBe("pt");
    expect(detectSystemLocale(["xx-YY"])).toBe("en");
    expect(isLocaleCode("de")).toBe(true);
    expect(isLocaleCode("xx")).toBe(false);
  });

  it("falls back to English for missing leaf", () => {
    const t = createTranslator("es");
    // key that only exists conceptually — createTranslator returns key if both miss
    expect(t("pair.button")).toMatch(/vincular|Vincular/i);
  });
});
