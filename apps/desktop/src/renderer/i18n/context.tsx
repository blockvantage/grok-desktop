import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CATALOG,
  DEFAULT_LOCALE,
  LOCALE_META,
  createTranslator,
  detectSystemLocale,
  isLocaleCode,
  loadStoredLocale,
  storeLocale,
  type TranslateFn,
} from "./catalog.js";
import type { LocaleCode, LocaleMeta } from "./types.js";
import { setActiveLocale } from "./active.js";

/** Last locale pushed to main (avoid IPC spam every render). */
let lastPushedMainLocale: string | null = null;

export type LocalePreference = LocaleCode | "system";

interface I18nContextValue {
  /** Resolved locale actually used for strings */
  locale: LocaleCode;
  /** User preference (may be "system") */
  preference: LocalePreference;
  setLocale: (next: LocalePreference) => void;
  t: TranslateFn;
  locales: LocaleMeta[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

const PREF_KEY = "grokdesk.localePreference.v1";

function loadPreference(): LocalePreference {
  try {
    if (typeof localStorage === "undefined") return "system";
    const v = localStorage.getItem(PREF_KEY);
    if (v === "system") return "system";
    if (isLocaleCode(v)) return v;
    // migrate old key
    const old = loadStoredLocale();
    return old ?? "system";
  } catch {
    return "system";
  }
}

function storePreference(pref: LocalePreference): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PREF_KEY, pref);
    if (pref !== "system") storeLocale(pref);
  } catch {
    // ignore
  }
}

function resolveLocale(pref: LocalePreference): LocaleCode {
  if (pref === "system") return detectSystemLocale();
  return pref in CATALOG ? pref : DEFAULT_LOCALE;
}

export function I18nProvider(props: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<LocalePreference>(loadPreference);
  const locale = useMemo(() => resolveLocale(preference), [preference]);

  const setLocale = useCallback((next: LocalePreference) => {
    setPreferenceState(next);
    storePreference(next);
  }, []);

  // Sync active locale during render (not a passive effect) so pure helpers
  // (greeting, labels, stream-view) see the new locale on the same paint.
  setActiveLocale(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : locale;
  }
  // LANG-4: push resolved locale to main so tray/native dialogs follow without restart.
  if (lastPushedMainLocale !== locale) {
    lastPushedMainLocale = locale;
    void window.grokdesk?.app?.setLocale?.(locale);
  }

  const t = useMemo(() => createTranslator(locale), [locale]);

  const value = useMemo(
    () => ({
      locale,
      preference,
      setLocale,
      t,
      locales: LOCALE_META,
    }),
    [locale, preference, setLocale, t],
  );

  return (
    <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Safe fallback for tests / components outside provider
    const locale = DEFAULT_LOCALE;
    return {
      locale,
      preference: "system",
      setLocale: () => undefined,
      t: createTranslator(locale),
      locales: LOCALE_META,
    };
  }
  return ctx;
}

export function useT(): TranslateFn {
  return useI18n().t;
}
