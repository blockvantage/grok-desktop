/**
 * Active locale for pure (non-React) modules: greeting, stream-view, labels, etc.
 * I18nProvider keeps this in sync with the UI language.
 */
import {
  createTranslator,
  DEFAULT_LOCALE,
  type TranslateFn,
} from "./catalog.js";
import type { LocaleCode } from "./types.js";

let activeLocale: LocaleCode = DEFAULT_LOCALE;
let cachedT: TranslateFn = createTranslator(DEFAULT_LOCALE);

export function setActiveLocale(locale: LocaleCode): void {
  if (locale === activeLocale) return;
  activeLocale = locale;
  cachedT = createTranslator(locale);
}

export function getActiveLocale(): LocaleCode {
  return activeLocale;
}

/**
 * BCP-47 tag for Intl.* date/number formatting.
 * zh renders as zh-CN per context.tsx documentElement.lang convention.
 */
export function getActiveIntlLocale(): string {
  const l = getActiveLocale();
  return l === "zh" ? "zh-CN" : l;
}

/** Translate with the currently active UI locale. */
export function t(
  key: string,
  vars?: Record<string, string | number>,
): string {
  return cachedT(key, vars);
}
