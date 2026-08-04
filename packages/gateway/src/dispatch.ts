import { parseIpcRequest, type IpcRequest } from "@grokdesk/shared";
import type { Gateway } from "./index.js";

export async function dispatchGateway(
  gateway: Gateway,
  raw: unknown,
): Promise<unknown> {
  const req = parseIpcRequest(raw);
  return gateway.handle(req);
}

export type { IpcRequest };
