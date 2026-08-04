/**
 * Human-facing labels. Never show raw engine enums to users.
 * Strings resolve through the active i18n locale.
 */

import { t, setActiveLocale, getActiveLocale } from "@/i18n/active";
import type { LocaleCode } from "@/i18n/types";

/** Called by I18nProvider when the UI language changes. */
export function setLabelsLocale(locale: LocaleCode): void {
  setActiveLocale(locale);
}

export function taskStatusLabel(status: string | null | undefined): string {
  if (!status) return t("status.unknown");
  const key = `status.${status}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return status.replace(/_/g, " ");
}

export function engineStatusLabel(status: string | null | undefined): string {
  // Missing or provisional status → "Checking…" rather than the raw "Unknown"
  // which reads like a fault when auth hasn't settled yet.
  if (!status || status === "unknown") return t("status.checking");
  const key = `status.${status}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return status;
}

export function effortLabel(effort: string | null | undefined): string {
  if (!effort) return "";
  const key = `effort.${effort}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return effort;
}

export function approvalLabel(mode: string | null | undefined): string {
  if (!mode) return "";
  const key = `approval.${mode}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return mode;
}

export function modeLabel(mode: string | null | undefined): string {
  if (!mode) return "";
  const key = `mode.${mode}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return mode.replace(/_/g, " ");
}

export function rolePackLabel(pack: string | null | undefined): string {
  if (!pack) return "";
  const key = `rolePack.${pack}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return pack
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function accountSubtitle(opts: {
  signedIn?: boolean;
  engineStatus?: string | null;
}): string {
  if (!opts.signedIn) return t("status.notSignedIn");
  if (opts.engineStatus === "missing") return t("status.cliMissing");
  if (opts.engineStatus === "needs_auth") return t("status.sessionExpired");
  return "SuperGrok";
}

/** Cron definitions; labels resolve through the active locale. */
const CRON_PRESET_DEFS: ReadonlyArray<{
  cron: string;
  labelKey: string;
  hintKey: string;
}> = [
  {
    cron: "0 9 * * 1-5",
    labelKey: "scheduled.cronWeekday9",
    hintKey: "scheduled.cronWeekday9Hint",
  },
  {
    cron: "0 9 * * 1",
    labelKey: "scheduled.cronMonday",
    hintKey: "scheduled.cronMondayHint",
  },
  {
    cron: "0 8 * * *",
    labelKey: "scheduled.cronDaily",
    hintKey: "scheduled.cronDailyHint",
  },
  {
    cron: "0 * * * *",
    labelKey: "scheduled.cronHourly",
    hintKey: "scheduled.cronHourlyHint",
  },
  {
    cron: "0 16 * * 5",
    labelKey: "scheduled.cronFriday4",
    hintKey: "scheduled.cronFriday4Hint",
  },
];

/** Localized cron presets for the schedule UI (recompute when locale changes). */
export function getCronPresets(): { label: string; cron: string; hint: string }[] {
  return CRON_PRESET_DEFS.map((p) => ({
    cron: p.cron,
    label: t(p.labelKey),
    hint: t(p.hintKey),
  }));
}

export function describeCron(cron: string): string {
  const hit = CRON_PRESET_DEFS.find((p) => p.cron === cron);
  if (hit) return t(hit.labelKey);
  return t("scheduled.customCron", { cron });
}

export { getActiveLocale };
