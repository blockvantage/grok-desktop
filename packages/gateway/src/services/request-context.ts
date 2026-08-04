/**
 * Request-scoped authorization context.
 * Remote transport MUST attach principalDeviceId from the authenticated channel.
 * Desktop IPC uses transport "desktop" with a null principal.
 */

export type TransportKind = "desktop" | "remote";

export interface RequestContext {
  transport: TransportKind;
  /** Authenticated paired device id when transport is remote; null for desktop. */
  principalDeviceId: string | null;
  machineId: string | null;
  requestId: string;
}

export function desktopRequestContext(requestId: string): RequestContext {
  return {
    transport: "desktop",
    principalDeviceId: null,
    machineId: null,
    requestId,
  };
}

export function remoteRequestContext(args: {
  principalDeviceId: string;
  machineId: string;
  requestId: string;
}): RequestContext {
  if (!args.principalDeviceId) {
    throw new Error("Remote RequestContext requires principalDeviceId");
  }
  return {
    transport: "remote",
    principalDeviceId: args.principalDeviceId,
    machineId: args.machineId,
    requestId: args.requestId,
  };
}

/**
 * Resolve the effective device id for a remote method.
 * Body deviceId must match principal or be omitted; conflicts are rejected.
 */
export function resolveRemoteDeviceId(
  ctx: RequestContext,
  bodyDeviceId: string | undefined | null,
): string {
  if (ctx.transport !== "remote" || !ctx.principalDeviceId) {
    throw new Error("Remote device identity requires remote principal context");
  }
  if (
    bodyDeviceId != null &&
    bodyDeviceId !== "" &&
    bodyDeviceId !== ctx.principalDeviceId
  ) {
    throw new Error(
      "Device identity mismatch: body deviceId does not match authenticated principal",
    );
  }
  return ctx.principalDeviceId;
}

/**
 * For optional body deviceId on stop/etc.: when remote, always principal;
 * when desktop, allow explicit body id.
 */
export function resolveOptionalRemoteDeviceId(
  ctx: RequestContext,
  bodyDeviceId: string | undefined | null,
): string | null {
  if (ctx.transport === "remote") {
    return resolveRemoteDeviceId(ctx, bodyDeviceId);
  }
  return bodyDeviceId && bodyDeviceId.length > 0 ? bodyDeviceId : null;
}
