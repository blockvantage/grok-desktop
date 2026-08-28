import cronParser from "cron-parser";

export function nextRunAt(
  cron: string,
  timezone: string,
  from: Date = new Date(),
): Date {
  const expr = cronParser.parseExpression(cron, {
    currentDate: from,
    tz: timezone,
  });
  return expr.next().toDate();
}

/** Minimal natural-language → cron map for v1. */
export function naturalLanguageToCron(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (
    s === "every monday 9am" ||
    s === "every monday at 9am" ||
    s === "mondays at 9am"
  ) {
    return "0 9 * * 1";
  }
  if (s === "every day 9am" || s === "daily at 9am" || s === "every morning") {
    return "0 9 * * *";
  }
  if (s === "every hour") {
    return "0 * * * *";
  }
  // Duration tokens (30m / 2h) — same map as /loop.
  const duration = s.replace(/^every\s+/, "");
  if (/^\d+\s*(m|min|mins|minutes|h|hr|hrs|hours|d|day|days)$/.test(duration)) {
    const n = Number(/^(\d+)/.exec(duration)?.[1] ?? 0);
    const unit = duration.replace(/^\d+\s*/, "")[0];
    if (n > 0 && unit === "m" && n < 60) {
      return n === 1 ? "* * * * *" : `*/${n} * * * *`;
    }
    if (n > 0 && unit === "h" && n < 24) {
      return n === 1 ? "0 * * * *" : `0 */${n} * * *`;
    }
    if (n > 0 && unit === "d") return n === 1 ? "0 9 * * *" : `0 9 */${n} * *`;
  }
  // Already looks like cron (5 fields)
  if (/^(\S+\s+){4}\S+$/.test(s)) return s;
  return null;
}

/** Minutes since local midnight for `now` in optional IANA timezone. */
function minutesOfDay(now: Date, timezone?: string): number {
  if (!timezone) {
    return now.getHours() * 60 + now.getMinutes();
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
    const minute = Number(
      parts.find((p) => p.type === "minute")?.value ?? NaN,
    );
    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      return now.getHours() * 60 + now.getMinutes();
    }
    return hour * 60 + minute;
  } catch {
    // Invalid IANA zone → fall back to host local clock.
    return now.getHours() * 60 + now.getMinutes();
  }
}

/** Parse `HH:MM` into minutes since midnight, or null when invalid. */
export function parseQuietHoursClock(raw: string): number | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return hour * 60 + minute;
}

export function isInQuietHours(
  now: Date,
  quiet: { start: string; end: string; timezone?: string } | null,
): boolean {
  if (!quiet) return false;
  const start = parseQuietHoursClock(quiet.start);
  const end = parseQuietHoursClock(quiet.end);
  // Fail open (not quiet) on corrupt settings rather than blocking forever.
  if (start == null || end == null) return false;
  const mins = minutesOfDay(now, quiet.timezone);
  if (start === end) return false;
  if (start < end) {
    return mins >= start && mins < end;
  }
  // wraps midnight
  return mins >= start || mins < end;
}
