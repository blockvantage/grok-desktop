/** Same locale set as desktop Grok Desk. */
export type LocaleCode = "en" | "es" | "fr" | "de" | "pt" | "ja" | "zh";

export type MessageTree = {
  [key: string]: string | MessageTree;
};

export interface LocaleMeta {
  code: LocaleCode;
  nativeName: string;
  englishName: string;
}

export type LocalePreference = LocaleCode | "system";
