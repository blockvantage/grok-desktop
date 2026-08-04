import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_META,
  createTranslator,
  detectSystemLocale,
  type TranslateFn,
} from "./catalog";
import {
  loadLocalePreference,
  resolvePreference,
  storeLocalePreference,
} from "./locale-storage";
import type { LocaleCode, LocaleMeta, LocalePreference } from "./types";

interface I18nContextValue {
  locale: LocaleCode;
  preference: LocalePreference;
  setLocale: (next: LocalePreference) => void;
  t: TranslateFn;
  locales: LocaleMeta[];
  ready: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider(props: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<LocalePreference>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pref = await loadLocalePreference();
      if (!cancelled) {
        setPreferenceState(pref);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const locale = useMemo(
    () => resolvePreference(preference, detectSystemLocale),
    [preference],
  );

  const setLocale = useCallback((next: LocalePreference) => {
    setPreferenceState(next);
    void storeLocalePreference(next);
  }, []);

  const t = useMemo(() => createTranslator(locale), [locale]);

  const value = useMemo(
    () => ({
      locale,
      preference,
      setLocale,
      t,
      locales: LOCALE_META,
      ready,
    }),
    [locale, preference, setLocale, t, ready],
  );

  return (
    <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Safe fallback for tests that render without provider
    const locale = DEFAULT_LOCALE;
    return {
      locale,
      preference: "system",
      setLocale: () => {},
      t: createTranslator(locale),
      locales: LOCALE_META,
      ready: true,
    };
  }
  return ctx;
}
