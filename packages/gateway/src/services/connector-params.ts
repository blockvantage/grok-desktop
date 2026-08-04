/**
 * Pure param parsing for connector IPC methods (Phase 6 extract).
 */

/**
 * Optional env map from connectors.enable params; undefined when absent/invalid.
 */
export function connectorEnvFromParams(
  params: Record<string, unknown> | { env?: unknown },
): Record<string, string> | undefined {
  const env = (params as { env?: unknown }).env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Optional serverId string for connectors.doctor.
 */
export function connectorDoctorServerId(
  params: Record<string, unknown> | { serverId?: unknown },
): string | undefined {
  const id = (params as { serverId?: unknown }).serverId;
  return typeof id === "string" ? id : undefined;
}
