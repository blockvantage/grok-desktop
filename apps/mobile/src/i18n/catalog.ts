import type { LocaleCode, LocaleMeta, MessageTree } from "./types";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import pt from "./locales/pt.json";
import ja from "./locales/ja.json";
import zh from "./locales/zh.json";

export const LOCALE_META: LocaleMeta[] = [
  { code: "en", nativeName: "English", englishName: "English" },
  { code: "es", nativeName: "Español", englishName: "Spanish" },
  { code: "fr", nativeName: "Français", englishName: "French" },
  { code: "de", nativeName: "Deutsch", englishName: "German" },
  { code: "pt", nativeName: "Português", englishName: "Portuguese" },
  { code: "ja", nativeName: "日本語", englishName: "Japanese" },
  { code: "zh", nativeName: "简体中文", englishName: "Chinese (Simplified)" },
];

export const CATALOG: Record<LocaleCode, MessageTree> = {
  en: en as MessageTree,
  es: es as MessageTree,
  fr: fr as MessageTree,
  de: de as MessageTree,
  pt: pt as MessageTree,
  ja: ja as MessageTree,
  zh: zh as MessageTree,
};

export const DEFAULT_LOCALE: LocaleCode = "en";

export function isLocaleCode(value: string | null | undefined): value is LocaleCode {
  return Boolean(value && value in CATALOG);
}

/** Detect locale from language tags (navigator / expo-localization). */
export function detectSystemLocale(
  languages: readonly string[] = getDeviceLanguageTags(),
): LocaleCode {
  for (const raw of languages) {
    const lower = raw.toLowerCase();
    const base = lower.split("-")[0] ?? "";
    if (isLocaleCode(base)) return base;
    if (lower.startsWith("zh")) return "zh";
    if (lower.startsWith("pt")) return "pt";
  }
  return DEFAULT_LOCALE;
}

function getDeviceLanguageTags(): string[] {
  try {
    // RN / Expo: prefer expo-localization when present
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoLoc = require("expo-localization") as {
      getLocales?: () => Array<{ languageTag?: string; languageCode?: string }>;
    };
    if (typeof ExpoLoc.getLocales === "function") {
      const tags = ExpoLoc.getLocales()
        .map((l) => l.languageTag || l.languageCode || "")
        .filter(Boolean);
      if (tags.length) return tags;
    }
  } catch {
    /* optional */
  }
  if (typeof navigator !== "undefined" && navigator.languages?.length) {
    return [...navigator.languages];
  }
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().locale;
    if (resolved) return [resolved];
  } catch {
    /* ignore */
  }
  return ["en"];
}

function lookup(tree: MessageTree, path: string): string | undefined {
  const parts = path.split(".");
  let cur: string | MessageTree | undefined = tree;
  for (const p of parts) {
    if (cur == null || typeof cur === "string") return undefined;
    cur = cur[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

export type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export function createTranslator(locale: LocaleCode): TranslateFn {
  const primary = CATALOG[locale] ?? CATALOG.en;
  const fallback = CATALOG.en;
  return (key, vars) => {
    let text = lookup(primary, key) ?? lookup(fallback, key) ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  };
}

export function flattenKeys(tree: MessageTree, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(path);
    else out.push(...flattenKeys(v, path));
  }
  return out;
}
