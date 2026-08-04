/**
 * Rotating main-process log under userData. Never write secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "./redact";

export type LogLevel = "info" | "warn" | "error";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB then rotate
const RING_MAX = 80;

let logDir: string | null = null;
let logPath: string | null = null;
const ring: string[] = [];

export function initMainLog(userDataPath: string): string {
  logDir = path.join(userDataPath, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  logPath = path.join(logDir, "main.log");
  return logPath;
}

export function getLogDir(): string | null {
  return logDir;
}

export function getLogPath(): string | null {
  return logPath;
}

/** Last N redacted lines for diagnostics copy. */
export function getRecentLogLines(max = 50): string[] {
  return ring.slice(-max);
}

function rotateIfNeeded(): void {
  if (!logPath || !fs.existsSync(logPath)) return;
  try {
    const st = fs.statSync(logPath);
    if (st.size < MAX_BYTES) return;
    const bak = `${logPath}.1`;
    if (fs.existsSync(bak)) fs.unlinkSync(bak);
    fs.renameSync(logPath, bak);
  } catch {
    // ignore rotate failures
  }
}

export function mainLog(
  level: LogLevel,
  message: string,
  extra?: string,
): void {
  const safe = redactSecrets(
    extra ? `${message} ${extra}` : message,
  ).replace(/\s+/g, " ").trim();
  const line = `${new Date().toISOString()} [${level}] ${safe}`;
  ring.push(line);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  if (!logPath) return;
  try {
    rotateIfNeeded();
    fs.appendFileSync(logPath, `${line}\n`, "utf8");
  } catch {
    // disk full etc.
  }
}
