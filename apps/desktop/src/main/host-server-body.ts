import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Default max JSON body for loopback browser/desktop host control planes. */
export const HOST_SERVER_MAX_BODY_BYTES = 1_048_576; // 1 MiB

/**
 * Constant-time compare for loopback host tokens. Header may be string | string[].
 */
export function hostTokenMatches(
  provided: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof provided !== "string" || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Read a JSON object body with a hard byte cap. Rejects oversized payloads
 * before buffering the whole stream into memory (local DoS protection).
 */
export function readLimitedJsonBody(
  req: IncomingMessage,
  maxBytes = HOST_SERVER_MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(err);
    };

    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        fail(new Error("payload_too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        const parsed = JSON.parse(raw) as unknown;
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("invalid_json_object"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error("invalid_json"));
      }
    });
  });
}
