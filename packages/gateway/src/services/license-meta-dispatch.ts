/**
 * Non-sensitive metadata dispatch. Licensing and update policy are owned by
 * narrow Electron main-process bridges and never traverse gateway RPC.
 */

import { ROLE_PACKS } from "@grokdesk/shared";
import { buildModelsListResponse } from "./models-list.js";

export type LicenseMetaDeps = {
  computeTrayStatus: () => unknown;
  getGrokAuthStatus: () => Promise<unknown>;
  /** Live provider catalog (ACP / fake); merged ahead of auth fallback. */
  listLiveModels?: () => Promise<string[]>;
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
      let live: string[] = [];
      try {
        live = (await deps.listLiveModels?.()) ?? [];
      } catch {
        live = [];
      }
      return buildModelsListResponse(st as never, "grok-4.5", live);
    }
    case "tray.status":
      return deps.computeTrayStatus();
    default:
      throw new Error(`Unhandled license/meta method: ${method}`);
  }
}
