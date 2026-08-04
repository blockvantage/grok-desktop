/**
 * connectors.* IPC dispatch (Phase 6 extract from Gateway.dispatch).
 * Doctor path must never return secret env values (CMD-03).
 */

import {
  connectorDoctorServerId,
  connectorEnvFromParams,
} from "./connector-params.js";

export type ConnectorDispatchDeps = {
  listPresets: () => unknown;
  enable: (
    input: { presetId: string; env?: Record<string, string> },
  ) => unknown | Promise<unknown>;
  disable: (presetId: string) => unknown | Promise<unknown>;
  enableRecommended: () => unknown | Promise<unknown>;
  doctor: (serverId?: string) => unknown | Promise<unknown>;
};

export const CONNECTOR_METHODS = new Set([
  "connectors.listPresets",
  "connectors.enable",
  "connectors.disable",
  "connectors.enableRecommended",
  "connectors.doctor",
]);

export function isConnectorMethod(method: string): boolean {
  return CONNECTOR_METHODS.has(method);
}

export async function dispatchConnectorMethod(
  method: string,
  params: Record<string, unknown>,
  deps: ConnectorDispatchDeps,
): Promise<unknown> {
  switch (method) {
    case "connectors.listPresets":
      return deps.listPresets();
    case "connectors.enable": {
      const presetId =
        typeof params.presetId === "string" ? params.presetId : "";
      if (!presetId) throw new Error("presetId required");
      const env = connectorEnvFromParams(params);
      return deps.enable({ presetId, env });
    }
    case "connectors.disable": {
      const presetId =
        typeof params.presetId === "string" ? params.presetId : "";
      if (!presetId) throw new Error("presetId required");
      return deps.disable(presetId);
    }
    case "connectors.enableRecommended":
      return deps.enableRecommended();
    case "connectors.doctor":
      // Static preflight — never returns secret env values (CMD-03).
      return deps.doctor(connectorDoctorServerId(params));
    default:
      throw new Error(`Unhandled connector method: ${method}`);
  }
}
