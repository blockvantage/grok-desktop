/**
 * Non-sensitive metadata dispatch. Licensing and update policy are owned by
 * narrow Electron main-process bridges and never traverse gateway RPC.
 */

import { ROLE_PACKS } from "@grokdesk/shared";
import { buildModelsListResponse } from "./models-list.js";

export type LicenseMetaDeps = {
  computeTrayStatus: () => unknown;
  getGrokAuthStatus: () => Promise<unknown>;
};

export const LICENSE_META_METHODS = new Set([
  "rolePacks.list",
  "models.list",
  "tray.status",
]);

export function isLicenseMetaMethod(method: string): boolean {
  return LICENSE_META_METHODS.has(method);
}

export async function dispatchLicenseMetaMethod(
  method: string,
  params: Record<string, unknown>,
  deps: LicenseMetaDeps,
): Promise<unknown> {
  switch (method) {
    case "rolePacks.list":
      return ROLE_PACKS;
    case "models.list": {
      const st = await deps.getGrokAuthStatus();
      return buildModelsListResponse(st as never);
    }
    case "tray.status":
      return deps.computeTrayStatus();
    default:
      throw new Error(`Unhandled license/meta method: ${method}`);
  }
}
