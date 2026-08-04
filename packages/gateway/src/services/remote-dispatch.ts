/**
 * Remote IPC method handlers — extracted from Gateway.dispatch (Phase 6).
 * Keeps transport (RemoteSessionHost) and principal binding (RequestContext)
 * separate from enable/pairing/telepresence orchestration.
 */
import type { IpcRequest } from "@grokdesk/shared";
import type { RequestContext } from "./request-context.js";
import {
  resolveOptionalRemoteDeviceId,
  resolveRemoteDeviceId,
} from "./request-context.js";
import type { RemoteService } from "./remote.js";
import type { TelepresenceService } from "./telepresence.js";
import type { RemoteSessionHost } from "./remote-session.js";

export type RemoteDispatchDeps = {
  remote: RemoteService;
  telepresence: TelepresenceService;
  remoteSession: RemoteSessionHost | null;
};

export async function dispatchRemoteMethod(
  req: Extract<
    IpcRequest,
    {
      method:
        | "remote.status"
        | "remote.enable"
        | "remote.disable"
        | "remote.pairing.start"
        | "remote.devices.list"
        | "remote.devices.revoke"
        | "remote.rekey"
        | "remote.telepresence.start"
        | "remote.telepresence.stop"
        | "remote.telepresence.setQuality"
        | "remote.telepresence.status"
        | "remote.telepresence.listDisplays"
        | "remote.telepresence.input";
    }
  >,
  requestCtx: RequestContext,
  deps: RemoteDispatchDeps,
): Promise<unknown> {
  switch (req.method) {
    case "remote.status": {
      const base = deps.remote.status();
      return {
        ...base,
        relayConnected: Boolean(deps.remoteSession?.isRelayReady()),
        telepresence: deps.telepresence.getState(),
      };
    }
    case "remote.enable":
      return deps.remote.enable(req.params.relayUrl);
    case "remote.disable":
      return deps.remote.disable();
    case "remote.pairing.start":
      return deps.remote.startPairing({
        ttlMs: req.params.ttlMs,
      });
    case "remote.devices.list":
      return deps.remote.listDevices().map((d) => ({
        id: d.id,
        label: d.label,
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
        revokedAt: d.revokedAt,
      }));
    case "remote.devices.revoke": {
      const deviceId =
        requestCtx.transport === "remote"
          ? resolveRemoteDeviceId(requestCtx, req.params.deviceId)
          : (req.params.deviceId as string);
      if (!deviceId) throw new Error("deviceId required");
      await deps.telepresence.stopIfDevice(deviceId);
      deps.remote.revokeDevice(deviceId);
      return { ok: true };
    }
    case "remote.rekey": {
      const deviceId =
        requestCtx.transport === "remote"
          ? resolveRemoteDeviceId(requestCtx, req.params.deviceId)
          : (req.params.deviceId as string);
      if (!deviceId) throw new Error("deviceId required");
      deps.remote.updateDevicePublicKey(deviceId, req.params.devicePub);
      deps.remoteSession?.forgetDevice(deviceId);
      return { ok: true };
    }
    case "remote.telepresence.start": {
      const deviceId =
        requestCtx.transport === "remote"
          ? resolveRemoteDeviceId(requestCtx, req.params.deviceId)
          : (req.params.deviceId as string);
      if (!deviceId) throw new Error("deviceId required");
      if (!deps.remote.isDeviceActive(deviceId)) {
        throw new Error("Device not active");
      }
      return deps.telepresence.start({
        deviceId,
        quality: req.params.quality,
        displayId: req.params.displayId,
      });
    }
    case "remote.telepresence.stop": {
      const owner = resolveOptionalRemoteDeviceId(
        requestCtx,
        req.params.deviceId,
      );
      if (requestCtx.transport === "remote" && owner) {
        deps.telepresence.assertOwner(owner);
      }
      return deps.telepresence.stop();
    }
    case "remote.telepresence.setQuality": {
      if (requestCtx.transport === "remote") {
        const owner = resolveRemoteDeviceId(requestCtx, req.params.deviceId);
        deps.telepresence.assertOwner(owner);
      }
      return deps.telepresence.setQuality(req.params.quality);
    }
    case "remote.telepresence.status":
      return deps.telepresence.getState();
    case "remote.telepresence.listDisplays":
      return deps.telepresence.listDisplays();
    case "remote.telepresence.input": {
      const principal =
        requestCtx.transport === "remote"
          ? resolveRemoteDeviceId(requestCtx, req.params.deviceId)
          : null;
      return deps.telepresence.handleInput(req.params, {
        principalDeviceId: principal,
      });
    }
    default: {
      const _e: never = req;
      throw new Error(`Unhandled remote method: ${(_e as IpcRequest).method}`);
    }
  }
}

export function isRemoteMethod(
  method: string,
): method is
  | "remote.status"
  | "remote.enable"
  | "remote.disable"
  | "remote.pairing.start"
  | "remote.devices.list"
  | "remote.devices.revoke"
  | "remote.rekey"
  | "remote.telepresence.start"
  | "remote.telepresence.stop"
  | "remote.telepresence.setQuality"
  | "remote.telepresence.status"
  | "remote.telepresence.listDisplays"
  | "remote.telepresence.input" {
  return method.startsWith("remote.");
}
