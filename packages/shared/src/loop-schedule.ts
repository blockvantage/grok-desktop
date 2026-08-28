/**
 * /loop → Desk scheduler (Phase 3.5 C7).
 * Interval strings like 30m / 2h / 1d become cron. Locale-free.
 */

export type LoopDraft = {
  intervalLabel: string;
  cron: string;
  prompt: string;
  name: string;
};

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

/**
 * Map a duration token to a 5-field cron.
 * Sub-minute intervals collapse to every minute (Desk tick is 30s).
 */
export function intervalToCron(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/^every\s+/, "");
  const m = /^(\d+)\s*(s|sec|secs|seconds|m|min|mins|minutes|h|hr|hrs|hours|d|day|days)$/.exec(
    s,
  );
  if (!m) {
    if (s === "hourly" || s === "hour") return "0 * * * *";
    if (s === "daily" || s === "day") return "0 9 * * *";
    return null;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]![0];
  if (unit === "s") {
    if (n >= 3600) return intervalToCron(`${Math.floor(n / 3600)}h`);
    if (n >= 60) return intervalToCron(`${Math.floor(n / 60)}m`);
    return "* * * * *";
  }
  if (unit === "m") {
    if (n >= 60) return intervalToCron(`${Math.floor(n / 60)}h`);
    if (n === 1) return "* * * * *";
    if (n > 59) return null;
    return `*/${n} * * * *`;
  }
  if (unit === "h") {
    if (n >= 24) return intervalToCron(`${Math.floor(n / 24)}d`);
    if (n === 1) return "0 * * * *";
    if (n > 23) return null;
    return `0 */${n} * * *`;
  }
  if (n === 1) return "0 9 * * *";
  if (n > 7) return null;
  return `0 9 */${n} * *`;
}

export function intervalLabelFromToken(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/^every\s+/, "");
  const m = /^(\d+)\s*(s|sec|secs|seconds|m|min|mins|minutes|h|hr|hrs|hours|d|day|days)$/.exec(
    s,
  );
  if (!m) return s ? `every ${s}` : "on a schedule";
  const n = Number(m[1]);
  const unit = m[2]![0];
  if (unit === "s") return n === 1 ? "every second" : `every ${n} seconds`;
  if (unit === "m") return n === 1 ? "every minute" : `every ${n} minutes`;
  if (unit === "h") return n === 1 ? "every hour" : `every ${n} hours`;
  return n === 1 ? "every day" : `every ${n} days`;
}

function clipName(prompt: string): string {
  const line = prompt.replace(/\s+/g, " ").trim();
  if (line.length <= 48) return line || "Repeating check";
  return `${line.slice(0, 47).trimEnd()}…`;
}

const INTERVAL_BODY =
  /^(?:\/loop\s+)?(?:every\s+)?(\d+\s*(?:s|sec|secs|seconds|m|min|mins|minutes|h|hr|hrs|hours|d|day|days)|hourly|daily)\s+([\s\S]+)$/i;

/**
 * Parse `/loop every 30m check deploy` (or the same without the /loop token).
 * Returns null when there is no interval + prompt pair.
 */
export function parseLoopDraft(text: string): LoopDraft | null {
  const raw = text.trim();
  if (!raw) return null;
  const stripped = raw
    .replace(/^\/loop\b\s*/i, "")
    .replace(/^check this on a repeating schedule\.?\s*/i, "")
    .trim();
  const m = INTERVAL_BODY.exec(stripped);
  if (!m) return null;
  const token = m[1]!.trim();
  const prompt = m[2]!.replace(/\s+/g, " ").trim();
  if (!prompt) return null;
  const cron = intervalToCron(token);
  if (!cron) return null;
  const intervalLabel = intervalLabelFromToken(token);
  return {
    intervalLabel,
    cron,
    prompt,
    name: clipName(prompt),
  };
}

export function decodeScheduledInterval(raw: unknown): string | null {
  const p = rec(raw) ?? {};
  return (
    str(p.interval) ??
    str(p.cron) ??
    str(p.every) ??
    (typeof p.intervalMs === "number" && Number.isFinite(p.intervalMs)
      ? `${Math.max(1, Math.round(p.intervalMs / 60_000))}m`
      : null)
  );
}
