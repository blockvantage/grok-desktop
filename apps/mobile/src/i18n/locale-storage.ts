/**
 * Persist locale preference (same key namespace as desktop where practical).
 * SecureStore on device; memory in Node/tests.
 */
import type { LocaleCode, LocalePreference } from "./types";
import { isLocaleCode } from "./catalog";

const PREF_KEY = "grokdesk.localePreference.v1";
const mem = new Map<string, string>();

async function setRaw(key: string, raw: string): Promise<void> {
  try {
    const SecureStore = await import("expo-secure-store").catch(() => null);
    if (SecureStore?.setItemAsync) {
      await SecureStore.setItemAsync(key, raw);
      return;
    }
  } catch {
    /* fall through */
  }
  mem.set(key, raw);
}

async function getRaw(key: string): Promise<string | null> {
  try {
    const SecureStore = await import("expo-secure-store").catch(() => null);
    if (SecureStore?.getItemAsync) {
      return (await SecureStore.getItemAsync(key)) ?? null;
    }
  } catch {
    /* fall through */
  }
  return mem.get(key) ?? null;
}

export async function loadLocalePreference(): Promise<LocalePreference> {
  const v = await getRaw(PREF_KEY);
  if (v === "system" || v === null) return "system";
  if (isLocaleCode(v)) return v;
  return "system";
}

export async function storeLocalePreference(
  pref: LocalePreference,
): Promise<void> {
  await setRaw(PREF_KEY, pref);
}

export function resolvePreference(
  pref: LocalePreference,
  detect: () => LocaleCode,
): LocaleCode {
  if (pref === "system") return detect();
  return isLocaleCode(pref) ? pref : "en";
}
