export type { LocaleCode, LocaleMeta, MessageTree } from "./types.js";
export type { TranslateFn } from "./catalog.js";
export {
  CATALOG,
  DEFAULT_LOCALE,
  LOCALE_META,
  createTranslator,
  detectSystemLocale,
  flattenKeys,
  isLocaleCode,
  loadStoredLocale,
  storeLocale,
} from "./catalog.js";
export {
  I18nProvider,
  useI18n,
  useT,
  type LocalePreference,
} from "./context.js";
export { setActiveLocale, getActiveLocale, t as translate } from "./active.js";
export {
  localizeConnector,
  localizeConnectors,
  localizeCategoryLabel,
} from "./localize-connector.js";
