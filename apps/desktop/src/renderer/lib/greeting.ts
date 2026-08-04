/**
 * Rotating home greeting. Varies by time of day and live context.
 * All user-facing strings go through i18n.
 */

import { t } from "@/i18n/active";

export interface GreetingContext {
  name: string;
  now: Date;
  total: number;
  running: number;
  done: number;
  artifacts: number;
  schedules: number;
}

export interface Greeting {
  title: string;
  subtitle: string;
}

const SALUTE_KEYS: Record<
  "morning" | "afternoon" | "evening" | "night",
  string[]
> = {
  morning: [
    "greeting.morning",
    "greeting.morning2",
    "greeting.morning3",
    "greeting.morning4",
  ],
  afternoon: [
    "greeting.afternoon",
    "greeting.afternoon2",
    "greeting.afternoon3",
  ],
  evening: ["greeting.evening", "greeting.evening2", "greeting.evening3"],
  night: ["greeting.night", "greeting.night2", "greeting.night3"],
};

function bucket(hour: number): keyof typeof SALUTE_KEYS {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

/** First name only, so "Marcos Maceo" greets as "Marcos". */
export function firstName(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw) return "";
  const base = raw.includes("@") ? raw.split("@")[0]! : raw;
  return base.split(/[\s._(-]/)[0] || "";
}

export function buildGreeting(ctx: GreetingContext): Greeting {
  const hour = ctx.now.getHours();
  const pool = SALUTE_KEYS[bucket(hour)];
  const seed = Math.floor(ctx.now.getTime() / (20 * 60 * 1000));
  const salute = t(pool[seed % pool.length]!);
  // SH-4: drop ", there" when name is unresolved — full stop after salute.
  const name = firstName(ctx.name);
  const title = name ? `${salute}, ${name}` : salute;

  // SH-2: no live-stat facts (running banner owns that). Prefer short
  // context for signed-in users with work; skip evergreen ad-copy then.
  const facts: string[] = [];
  if (ctx.done > 0) {
    facts.push(
      ctx.done === 1
        ? t("greeting.doneOne")
        : t("greeting.doneMany", { n: ctx.done }),
    );
  }
  if (ctx.artifacts > 0) {
    facts.push(
      ctx.artifacts === 1
        ? t("greeting.artifactsOne")
        : t("greeting.artifactsMany", { n: ctx.artifacts }),
    );
  }
  if (ctx.schedules > 0) {
    facts.push(
      ctx.schedules === 1
        ? t("greeting.schedulesOne")
        : t("greeting.schedulesMany", { n: ctx.schedules }),
    );
  }
  // Evergreen only for first-run / empty desks.
  if (facts.length === 0 || ctx.total === 0) {
    facts.push(t("greeting.evergreen1"));
    facts.push(t("greeting.evergreen2"));
    facts.push(t("greeting.evergreen3"));
  }

  const subtitle = facts[seed % facts.length]!;
  return { title, subtitle };
}
