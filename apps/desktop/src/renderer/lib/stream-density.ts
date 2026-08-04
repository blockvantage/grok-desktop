/**
 * Stream density mode values for task workspace (Phase 6 extract).
 */

export type StreamDensity = "chat" | "tools" | "log";

export const STREAM_DENSITIES: StreamDensity[] = ["chat", "tools", "log"];

export function isStreamDensity(value: string): value is StreamDensity {
  return value === "chat" || value === "tools" || value === "log";
}
