import { GROKDESK_VERSION } from "@grokdesk/shared";

/** Single ACP clientInfo — sourced from the Desk app version. */
export function grokAcpClientInfo(): { name: string; version: string } {
  return { name: "grok-desk", version: GROKDESK_VERSION };
}

/** Initialize params: advertise live SessionStatus (`x.ai/statusLine`). */
export function grokAcpInitializeParams(clientInfo?: {
  name?: string;
  version?: string;
}): {
  protocolVersion: number;
  clientInfo: { name: string; version: string };
  clientCapabilities: { fs: { readTextFile: boolean; writeTextFile: boolean } };
  _meta: { "x.ai/statusLine": true };
} {
  return {
    protocolVersion: 1,
    clientInfo: {
      name: clientInfo?.name ?? grokAcpClientInfo().name,
      version: clientInfo?.version ?? grokAcpClientInfo().version,
    },
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
    },
    _meta: { "x.ai/statusLine": true },
  };
}
