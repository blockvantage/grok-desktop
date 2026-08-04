import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_LOCALES } from "./catalog.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "locales");
// Derived, not hardcoded: a locale added to the catalog must not escape this guard.
const LOCALES = ALL_LOCALES.filter((c) => c !== "en");
// Long strings legitimately identical to English. Entries are "<locale>:<key>",
// or "*:<key>" when every locale is exempt. Scope to a single locale whenever
// the reason is language-specific, so the others stay guarded. Short strings
// (<= 15 chars) never reach this set — do not list them here.
// Extend ONLY with a comment justifying each entry.
const ALLOW = new Set([
  // Product name of an external service — untranslated in every language.
  "*:connector.aws-kb.name",
  // "conversation"/"conversations" is the correct French noun — identical to en
  // by language, not by omission. Every other locale translates both keys.
  "fr:conversation.countOne",
  "fr:conversation.countMany",
]);

const allowed = (locale: string, key: string) =>
  ALLOW.has(`*:${key}`) || ALLOW.has(`${locale}:${key}`);

function flat(o: Record<string, unknown>, p = ""): [string, unknown][] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v as Record<string, unknown>, `${p}${k}.`) : [[`${p}${k}`, v]],
  );
}
const load = (l: string) =>
  new Map(flat(JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), "utf8"))));
const en = load("en");

describe("locale files", () => {
  for (const l of LOCALES) {
    it(`${l} has exact key parity with en`, () => {
      const m = load(l);
      const missing = [...en.keys()].filter((k) => !m.has(k));
      expect(missing, `keys missing from ${l}: ${missing.slice(0, 8).join(", ")}`).toEqual([]);
      const extra = [...m.keys()].filter((k) => !en.has(k));
      expect(extra, `keys in ${l} not in en: ${extra.slice(0, 8).join(", ")}`).toEqual([]);
    });
    it(`${l} has no untranslated long strings`, () => {
      const m = load(l);
      const stale = [...en]
        .filter(
          ([k, v]) =>
            typeof v === "string" && v.length > 15 && !allowed(l, k) && m.get(k) === v,
        )
        .map(([k]) => k);
      expect(stale).toEqual([]);
    });
  }
});
