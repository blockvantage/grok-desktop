/** Supported UI locales for Grok Desk. */
export type LocaleCode =
  | "en"
  | "es"
  | "fr"
  | "de"
  | "pt"
  | "ja"
  | "zh";

export type MessageTree = {
  [key: string]: string | MessageTree;
};

export interface LocaleMeta {
  code: LocaleCode;
  /** Native name, e.g. Español */
  nativeName: string;
  /** English name for the picker subtitle */
  englishName: string;
}
